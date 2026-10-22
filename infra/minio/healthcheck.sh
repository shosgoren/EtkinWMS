#!/bin/sh
set -eu
# BusyBox wget does not implement no_proxy. Honor only the existing exact
# exception for this fixed loopback URL; never add an exception or change env.
case ",${no_proxy-${NO_PROXY-}}," in
  *,127.0.0.1,*|*,127.0.0.1:9000,*)
    exec wget -Y off -q -O /dev/null http://127.0.0.1:9000/minio/health/live
    ;;
  *)
    exec wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live
    ;;
esac
