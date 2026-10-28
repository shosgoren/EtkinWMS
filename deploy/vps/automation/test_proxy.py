"""Real isolated Caddy/Docker regression for release-time DNS/connect gaps. No production access."""
import concurrent.futures
import ipaddress
import os
import pathlib
import re
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[3]
BACKEND_IMAGE = os.environ.get('PROXY_TEST_BACKEND_IMAGE', 'node:24-alpine')
BACKEND = r'''
const http=require('node:http');let count=0;
const server=http.createServer((req,res)=>{
 if(req.method==='POST'){req.resume();req.on('end',()=>{count++;req.socket.destroy();});return;}
 if(req.url==='/drop'){count++;req.socket.destroy();return;}
 const value=req.url==='/count'?String(count):(req.headers['fly-client-ip']||'ready');
 res.writeHead(200);res.end(req.method==='HEAD'?'':value);
});
setTimeout(()=>server.listen(3000,'0.0.0.0'),Number(process.env.START_DELAY||0)*1000);
'''


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.PIPE, timeout=120).strip()


class ProxyReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for image in ['caddy:2', BACKEND_IMAGE]:
            if subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                docker('pull', image)

    def setUp(self):
        self.tag = 'etkin-proxy-test-' + uuid.uuid4().hex[:12]
        self.containers = []
        self.tmp = tempfile.TemporaryDirectory(prefix=self.tag)
        self.addCleanup(self.tmp.cleanup)
        docker('network', 'create', self.tag)
        self.addCleanup(self.clean_docker)
        source = (ROOT / 'deploy/vps/Caddyfile').read_text()
        # Same directives/routes as production; only listen addresses become local HTTP (no ACME or production traffic).
        source = re.sub(r'(?m)^(wms\.etkinyazilim\.com|yonet\.etkinyazilim\.com|etkinyazilim\.com) \{', r'http://\1:8080 {', source)
        source = source.replace('www.etkinyazilim.com, etkinyazilim.com.tr, www.etkinyazilim.com.tr {', 'http://www.etkinyazilim.com:8080, http://etkinyazilim.com.tr:8080, http://www.etkinyazilim.com.tr:8080 {')
        config = pathlib.Path(self.tmp.name) / 'Caddyfile'
        config.write_text(source)
        self.proxy = self.tag + '-proxy'
        self.containers.append(self.proxy)
        docker('run', '--rm', '-d', '--name', self.proxy, '--network', self.tag, '-p', '127.0.0.1::8080', '-v', str(config) + ':/etc/caddy/Caddyfile:ro', 'caddy:2')
        self.port = int(docker('port', self.proxy, '8080/tcp').split(':')[-1])
        for _ in range(100):
            try:
                if self.request('/api/public/probe')[0] == 404:
                    break
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        else:
            self.fail('isolated proxy did not start')

    def clean_docker(self):
        for name in reversed(self.containers):
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['docker', 'network', 'rm', self.tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def backend(self, delay=0):
        name = self.tag + '-backend'
        self.containers.append(name)
        docker('run', '--rm', '-d', '--name', name, '--network', self.tag, '--network-alias', 'web', '-e', 'START_DELAY=' + str(delay), BACKEND_IMAGE, 'node', '-e', BACKEND)

    def request(self, path='/', method='GET', spoof=False):
        headers = {'Host': 'wms.etkinyazilim.com'}
        if spoof:
            headers['Fly-Client-IP'] = '198.51.100.99'
        req = urllib.request.Request('http://127.0.0.1:' + str(self.port) + path, headers=headers, method=method, data=b'synthetic' if method == 'POST' else None)
        try:
            with urllib.request.urlopen(req, timeout=22) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            try:
                return e.code, e.read().decode()
            finally:
                e.close()

    def test_dns_gap_waits_for_backend_in_same_request(self):
        with concurrent.futures.ThreadPoolExecutor() as pool:
            read = pool.submit(self.request)
            time.sleep(.6)
            self.assertFalse(read.done())
            self.backend()
            self.assertEqual(read.result()[0], 200)

    def test_connect_gap_head_and_trusted_ip_boundary(self):
        self.backend(delay=1)
        self.assertEqual(self.request(method='HEAD')[0], 200)
        status, ip = self.request(spoof=True)
        self.assertEqual(status, 200)
        self.assertNotEqual(ip, '198.51.100.99')
        ipaddress.ip_address(ip)
        self.assertEqual(self.request('/api/public/blocked')[0], 404)

    def test_reached_get_and_post_are_not_replayed(self):
        self.backend()
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request('/drop')[0], 502)
        self.assertEqual(self.request('/count')[1], '1')
        self.assertEqual(self.request('/drop', method='POST')[0], 502)
        self.assertEqual(self.request('/count')[1], '2')

    def test_permanent_dns_outage_has_bounded_wait(self):
        start = time.monotonic()
        self.assertEqual(self.request()[0], 502)
        duration = time.monotonic() - start
        self.assertGreaterEqual(duration, 14)
        self.assertLess(duration, 22)


if __name__ == '__main__':
    unittest.main()
