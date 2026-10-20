-- 0054_support_tickets (T-967, B-84): müşterinin bize (Etkin ekibi) yazdığı destek talebi ve yazışması. G-08: yalnız GENİŞLETME.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * TABLOLAR tenant verisidir (public, ENABLE + FORCE RLS, TO'suz izolasyon politikası, AC-04). Talep gövdesi (≤ 2000) ilk mesajdır;
--   sonraki yazışma `support_ticket_messages`'ta (append-only; UPDATE/DELETE yetkisi yok, tetikleyici sahibi de reddeder).
-- * KİM NEYİ GÖRÜR (wms_app, ek RESTRICTIVE politika yalnız TO wms_app): üye yalnız KENDİ açtığı talebi görür; hesap yöneticisi
--   (TENANT_ADMIN, ACTIVE üyelik) firmanın bütün taleplerini görür ve yanıtlayabilir. Gerekçe: talep firma ile tedarikçi arasındaki
--   yazışmadır; firmanın sözleşme tarafı ve ekip/ayar yetkisinin tek sahibi TENANT_ADMIN'dir (permissions.ts: users.manage/settings.manage
--   yalnız bu rolde). Depo yöneticisi başka kişinin notunu görmez (kişisel ifade/şikâyet içerebilir). Mesaj görünürlüğü talebin
--   görünürlüğünden türer (alt sorgu talep politikasından geçer).
-- * KİM AÇAR: her ACTIVE üye (rol şartı yok); `created_by` = bağlamdaki kullanıcı, `membership_id` onun bu tenant'taki ACTIVE üyeliği
--   (tetikleyici zorlar). Demo ve ACTIVE olmayan tenant'ta açılamaz (genel demo hesabından operatöre istenmeyen bildirim gitmesin).
-- * HIZ SINIRI DB'de: kullanıcı başına (tenant içinde) 10 dakikada en çok 5 talep ve 20 yanıt; aşımda SQLSTATE `P0429`. Eşzamanlı iki
--   istek aynı sınırı aşamasın diye kullanıcı başına transaction kilidi.
-- * SUNUCU ALANLARI: durum, zamanlar, numara ve yanıt damgaları istemciden gelmez (tetikleyici zorlar). Uygulama yalnız
--   ANSWERED → OPEN (müşteri yanıtı) ve `customer_seen_at` (okundu) değiştirebilir; ANSWERED/CLOSED yalnız operatör işlevlerinden.
-- * BAĞLAM (`context`): yalnız route, app_version, support_code, user_agent anahtarları, metin, toplam en çok 1200 karakter.
-- * NUMARA: küresel `number` (kimlik sütunu) — WhatsApp/telefonda "talep 42" denebilsin. Bilinen sınır: müşteri numaradan toplam talep
--   hacmini kabaca çıkarabilir; içerik ya da başka firma bilgisi sızmaz (kabul edildi).
-- * OPERATÖR (panel) erişimi yalnız `wms_probe.platform_support_*` SECURITY DEFINER işlevleriyle (sahip wms_identity_probe, search_path
--   sabit, PUBLIC EXECUTE yok, operatör denetimi `platform_is_operator`). Probe'a tenant tablosunda POLİTİKA EKLENMEZ (0042 kararı): işlev
--   bağlamı her tenant için transaction-yerel kurar, TO'suz izolasyon politikasından geçer ve önceki bağlamı geri yükler. Probe'a dar sütun
--   yetkileri: talepte SELECT + UPDATE (status, updated_at, operator_replied_at), mesajda SELECT + INSERT. Operatör işlemleri
--   `security_events` `platform.support.*` olarak yazılır (görüntüleme, yanıt, durum; tenant + talep kimliği; içerik yok).
-- * Ekran görüntüsü bu sürümde YOK (sonraki tur; depolama + tarama ayrı karar).
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('wms_probe.credentials_changed_since(uuid, timestamptz)') IS NULL THEN
    RAISE EXCEPTION '0054_support_tickets: 0053 önkoşulu yok';
  END IF;
END
$pre$;

CREATE TABLE public.support_tickets (
  tenant_id            uuid        NOT NULL,
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  number               bigint      GENERATED ALWAYS AS IDENTITY,
  created_by           uuid        NOT NULL,
  membership_id        uuid        NOT NULL,
  subject_kind         text        NOT NULL,
  body                 text        NOT NULL,
  context              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status               text        NOT NULL DEFAULT 'OPEN',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  operator_replied_at  timestamptz,
  customer_seen_at     timestamptz,
  CONSTRAINT support_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT support_tickets_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT support_tickets_number_key UNIQUE (number),
  CONSTRAINT support_tickets_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT support_tickets_creator_fkey FOREIGN KEY (created_by) REFERENCES public.users (id),
  CONSTRAINT support_tickets_member_fkey FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships (tenant_id, id),
  CONSTRAINT support_tickets_subject_chk CHECK (subject_kind IN ('BUG', 'HOWTO', 'IDEA', 'OTHER')),
  CONSTRAINT support_tickets_body_chk CHECK (pg_catalog.length(pg_catalog.btrim(body)) BETWEEN 1 AND 2000),
  CONSTRAINT support_tickets_status_chk CHECK (status IN ('OPEN', 'ANSWERED', 'CLOSED')),
  CONSTRAINT support_tickets_context_chk CHECK (
    pg_catalog.jsonb_typeof(context) = 'object'
    AND (context - ARRAY['route', 'app_version', 'support_code', 'user_agent']) = '{}'::jsonb
    AND pg_catalog.length(context::text) <= 1200
    AND NOT pg_catalog.jsonb_path_exists(context, '$.* ? (@.type() != "string")'))
);
CREATE INDEX support_tickets_creator_idx ON public.support_tickets (tenant_id, created_by, created_at);
CREATE INDEX support_tickets_status_idx ON public.support_tickets (tenant_id, status, updated_at);

CREATE TABLE public.support_ticket_messages (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticket_id       uuid        NOT NULL,
  author_kind     text        NOT NULL,
  author_user_id  uuid        NOT NULL,
  body            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_messages_pkey PRIMARY KEY (id),
  CONSTRAINT support_ticket_messages_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT support_ticket_messages_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id),
  CONSTRAINT support_ticket_messages_ticket_fkey FOREIGN KEY (tenant_id, ticket_id) REFERENCES public.support_tickets (tenant_id, id),
  CONSTRAINT support_ticket_messages_author_fkey FOREIGN KEY (author_user_id) REFERENCES public.users (id),
  CONSTRAINT support_ticket_messages_kind_chk CHECK (author_kind IN ('CUSTOMER', 'OPERATOR')),
  CONSTRAINT support_ticket_messages_body_chk CHECK (pg_catalog.length(pg_catalog.btrim(body)) BETWEEN 1 AND 2000)
);
CREATE INDEX support_ticket_messages_ticket_idx ON public.support_ticket_messages (tenant_id, ticket_id, created_at);
CREATE INDEX support_ticket_messages_author_idx ON public.support_ticket_messages (tenant_id, author_user_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- RLS: TO'suz izolasyon (AC-04) + yalnız wms_app için kısıtlayıcı talep sahibi / hesap yöneticisi kuralı
-- ---------------------------------------------------------------------------------------------
DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets', 'support_ticket_messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         USING      (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(pg_catalog.current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      t || '_isolation', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
  END LOOP;
END
$rls$;

CREATE POLICY support_tickets_requester ON public.support_tickets AS RESTRICTIVE TO wms_app
  USING (
    created_by = NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM public.tenant_memberships m
                 JOIN public.membership_roles r ON r.tenant_id = m.tenant_id AND r.membership_id = m.id
                WHERE m.tenant_id = support_tickets.tenant_id
                  AND m.user_id = NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid
                  AND m.status = 'ACTIVE' AND r.role_key = 'TENANT_ADMIN'))
  WITH CHECK (
    created_by = NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM public.tenant_memberships m
                 JOIN public.membership_roles r ON r.tenant_id = m.tenant_id AND r.membership_id = m.id
                WHERE m.tenant_id = support_tickets.tenant_id
                  AND m.user_id = NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid
                  AND m.status = 'ACTIVE' AND r.role_key = 'TENANT_ADMIN'));

-- Mesaj, bağlı talep görünüyorsa görünür/yazılır (alt sorgu support_tickets politikalarından geçer).
CREATE POLICY support_ticket_messages_requester ON public.support_ticket_messages AS RESTRICTIVE TO wms_app
  USING (EXISTS (SELECT 1 FROM public.support_tickets t
                  WHERE t.tenant_id = support_ticket_messages.tenant_id AND t.id = support_ticket_messages.ticket_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.support_tickets t
                       WHERE t.tenant_id = support_ticket_messages.tenant_id AND t.id = support_ticket_messages.ticket_id));

-- ---------------------------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------------------------
GRANT SELECT (tenant_id, id, number, created_by, membership_id, subject_kind, body, context, status, created_at, updated_at,
              operator_replied_at, customer_seen_at) ON public.support_tickets TO wms_app;
GRANT INSERT (tenant_id, id, created_by, membership_id, subject_kind, body, context) ON public.support_tickets TO wms_app;
GRANT UPDATE (status, updated_at, customer_seen_at) ON public.support_tickets TO wms_app;
GRANT SELECT (tenant_id, id, ticket_id, author_kind, author_user_id, body, created_at) ON public.support_ticket_messages TO wms_app;
GRANT INSERT (tenant_id, id, ticket_id, author_kind, author_user_id, body) ON public.support_ticket_messages TO wms_app;

GRANT SELECT ON public.support_tickets, public.support_ticket_messages TO wms_identity_probe;
GRANT UPDATE (status, updated_at, operator_replied_at) ON public.support_tickets TO wms_identity_probe;
GRANT INSERT (tenant_id, ticket_id, author_kind, author_user_id, body) ON public.support_ticket_messages TO wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- Tetikleyiciler (SECURITY INVOKER; yazan rolün kendi RLS'i ve yetkisiyle)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.support_tickets_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Bağlam dışı tenant anahtarı: RLS WITH CHECK reddetsin (tetikleyici başka tenant'ı sorgulamaz).
    IF NEW.tenant_id IS DISTINCT FROM v_ctx THEN
      RETURN NEW;
    END IF;
    IF v_uid IS NULL OR NEW.created_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'support_tickets: talep yalnız bağlamdaki kullanıcı adına açılır' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships m
                    WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.membership_id AND m.user_id = v_uid AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'support_tickets: etkin üyelik yok' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.status = 'ACTIVE' AND NOT t.is_demo) THEN
      RAISE EXCEPTION 'support_tickets: bu alanda destek talebi açılamaz' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support.rate:' || NEW.tenant_id::text || ':' || v_uid::text, 0));
    IF (SELECT count(*) FROM public.support_tickets s
         WHERE s.tenant_id = NEW.tenant_id AND s.created_by = v_uid AND s.created_at > now() - interval '10 minutes') >= 5 THEN
      RAISE EXCEPTION 'support_tickets: hız sınırı' USING ERRCODE = 'P0429';
    END IF;
    NEW.status := 'OPEN';
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.operator_replied_at := NULL;
    NEW.customer_seen_at := NULL;
    RETURN NEW;
  END IF;
  -- UPDATE: kimlik ve içerik değişmez (sahip/migration dahil).
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.context IS DISTINCT FROM OLD.context OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'support_tickets: talep içeriği değiştirilemez' USING ERRCODE = '42501';
  END IF;
  IF current_user::text = 'wms_identity_probe' THEN
    -- Operatör işlevleri: durum (OPEN/ANSWERED/CLOSED) ve yanıt damgası; okundu damgası müşterinindir.
    IF NEW.customer_seen_at IS DISTINCT FROM OLD.customer_seen_at THEN
      RAISE EXCEPTION 'support_tickets: okundu damgası müşterinindir' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Uygulama: yalnız ANSWERED → OPEN (müşteri yanıtı) ve okundu damgası; yanıt damgası operatörün.
    IF NEW.operator_replied_at IS DISTINCT FROM OLD.operator_replied_at THEN
      RAISE EXCEPTION 'support_tickets: yanıt damgası yalnız operatörce yazılır' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'ANSWERED' AND NEW.status = 'OPEN') THEN
      RAISE EXCEPTION 'support_tickets: durum geçişi yetkisiz (% → %)', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    -- ANSWERED → OPEN yalnız aynı transaction'da yazılmış müşteri yanıtıyla (mesaj created_at = now() tetikleyicide zorlanır).
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
         SELECT 1 FROM public.support_ticket_messages m
          WHERE m.tenant_id = OLD.tenant_id AND m.ticket_id = OLD.id AND m.author_kind = 'CUSTOMER' AND m.created_at = now()) THEN
      RAISE EXCEPTION 'support_tickets: yeniden açma yalnız müşteri yanıtıyla' USING ERRCODE = '42501';
    END IF;
    -- Okundu damgası yalnız talep sahibinindir (hesap yöneticisi başkasının uyarısını söndüremez); değer sunucu saatidir.
    IF NEW.customer_seen_at IS DISTINCT FROM OLD.customer_seen_at THEN
      IF OLD.created_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'support_tickets: okundu damgası yalnız talep sahibinindir' USING ERRCODE = '42501';
      END IF;
      NEW.customer_seen_at := now();
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.operator_replied_at IS DISTINCT FROM OLD.operator_replied_at THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.support_tickets_guard() FROM PUBLIC;
CREATE TRIGGER support_tickets_guard BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.support_tickets_guard();

CREATE FUNCTION public.support_ticket_messages_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  v_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'support_ticket_messages: yazışma değiştirilemez/silinemez' USING ERRCODE = '42501';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM v_ctx THEN
    RETURN NEW; -- RLS WITH CHECK reddeder
  END IF;
  IF v_uid IS NULL OR NEW.author_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'support_ticket_messages: yazar bağlamdaki kullanıcı olmalı' USING ERRCODE = '42501';
  END IF;
  IF (current_user::text = 'wms_identity_probe') <> (NEW.author_kind = 'OPERATOR') THEN
    RAISE EXCEPTION 'support_ticket_messages: yazar türü yetkisiz' USING ERRCODE = '42501';
  END IF;
  SELECT t.status INTO v_status FROM public.support_tickets t WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.ticket_id;
  IF NOT FOUND THEN
    RETURN NEW; -- görünmeyen talep: RLS WITH CHECK / FK reddeder
  END IF;
  IF v_status = 'CLOSED' THEN
    RAISE EXCEPTION 'support_ticket_messages: kapalı talebe yazılamaz' USING ERRCODE = '55000';
  END IF;
  IF NEW.author_kind = 'CUSTOMER' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support.rate:' || NEW.tenant_id::text || ':' || v_uid::text, 0));
    IF (SELECT count(*) FROM public.support_ticket_messages s
         WHERE s.tenant_id = NEW.tenant_id AND s.author_user_id = v_uid AND s.author_kind = 'CUSTOMER'
           AND s.created_at > now() - interval '10 minutes') >= 20 THEN
      RAISE EXCEPTION 'support_ticket_messages: hız sınırı' USING ERRCODE = 'P0429';
    END IF;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.support_ticket_messages_guard() FROM PUBLIC;
CREATE TRIGGER support_ticket_messages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_ticket_messages_guard();

-- ---------------------------------------------------------------------------------------------
-- Operatör işlevleri (SET ROLE kalıbı, 0042 ile aynı)
-- ---------------------------------------------------------------------------------------------
GRANT CREATE ON SCHEMA wms_probe TO wms_identity_probe;
SET ROLE wms_identity_probe;

-- Gelen kutusu: durum ('ALL' ya da OPEN/ANSWERED/CLOSED) ve isteğe bağlı müşteri süzgeci; en yeni güncellenen önce, en çok p_limit.
-- Demo tenant listelenmez. Önizleme gövdenin ilk 140 karakteri; yazar adı (yanıtlayabilmek için) ve firma adı döner, bağlam dönmez.
CREATE FUNCTION wms_probe.platform_support_list(p_status text, p_tenant uuid, p_limit integer)
RETURNS TABLE (id uuid, number bigint, tenant_id uuid, tenant_name text, tenant_slug text, subject_kind text, status text,
               created_at timestamptz, updated_at timestamptz, message_count integer, last_author text, preview text, author_name text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text;
  r record;
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_support_list: operatör değil' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('ALL', 'OPEN', 'ANSWERED', 'CLOSED') THEN
    RAISE EXCEPTION 'platform_support_list: durum biçimsiz' USING ERRCODE = '22023';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  -- Tenant başına en yeni p_limit satır; genel sıralama ve kesme çağıranda (domain) yapılır.
  FOR r IN SELECT t.id AS tid, t.name AS tname, t.slug AS tslug FROM public.tenants t
            WHERE NOT t.is_demo AND (p_tenant IS NULL OR t.id = p_tenant) LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', r.tid::text, true);
    RETURN QUERY
      SELECT s.id, s.number, s.tenant_id, r.tname, r.tslug, s.subject_kind, s.status, s.created_at, s.updated_at,
             (SELECT count(*)::integer FROM public.support_ticket_messages m WHERE m.tenant_id = s.tenant_id AND m.ticket_id = s.id),
             coalesce((SELECT m.author_kind FROM public.support_ticket_messages m WHERE m.tenant_id = s.tenant_id AND m.ticket_id = s.id
                        ORDER BY m.created_at DESC, m.id DESC LIMIT 1), 'CUSTOMER'),
             pg_catalog.left(s.body, 140), u.name
        FROM public.support_tickets s LEFT JOIN public.users u ON u.id = s.created_by
       WHERE s.tenant_id = r.tid AND (p_status = 'ALL' OR s.status = p_status)
       ORDER BY s.updated_at DESC, s.id LIMIT v_limit;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
END
$fn$;

-- Açık (OPEN) talep sayısı: panel rozeti. Demo hariç.
CREATE FUNCTION wms_probe.platform_support_open_count() RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text;
  v_tid uuid;
  v_n integer := 0;
  v_c integer;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_support_open_count: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR v_tid IN SELECT t.id FROM public.tenants t WHERE NOT t.is_demo LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', v_tid::text, true);
    SELECT count(*)::integer INTO v_c FROM public.support_tickets s WHERE s.tenant_id = v_tid AND s.status = 'OPEN';
    v_n := v_n + v_c;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  RETURN v_n;
END
$fn$;

-- Talep ayrıntısı (tek satır): bağlam bilgisiyle. Bulunamazsa P0002. Tenant kimliği çağırandan alınmaz; talepten bulunur.
-- Açılış `platform.support.viewed` olarak denetlenir (güvenlik incelemesi MINOR-1).
CREATE FUNCTION wms_probe.platform_support_get(p_ticket uuid)
RETURNS TABLE (id uuid, number bigint, tenant_id uuid, tenant_name text, tenant_slug text, subject_kind text, status text,
               created_at timestamptz, updated_at timestamptz, body text, context jsonb, author_name text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text;
  r record;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_support_get: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR r IN SELECT t.id AS tid, t.name AS tname, t.slug AS tslug FROM public.tenants t WHERE NOT t.is_demo LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', r.tid::text, true);
    RETURN QUERY
      SELECT s.id, s.number, s.tenant_id, r.tname, r.tslug, s.subject_kind, s.status, s.created_at, s.updated_at, s.body, s.context, u.name
        FROM public.support_tickets s LEFT JOIN public.users u ON u.id = s.created_by
       WHERE s.tenant_id = r.tid AND s.id = p_ticket;
    IF FOUND THEN
      PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
      -- Destek erişimi denetimi (I-12): operatörün talep ayrıntısını açması iz bırakır (içerik yok).
      INSERT INTO public.security_events (user_id, event_type, detail)
      VALUES (NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid, 'platform.support.viewed',
              pg_catalog.jsonb_build_object('tenant_id', r.tid::text, 'ticket_id', p_ticket::text));
      RETURN;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  RAISE EXCEPTION 'platform_support_get: talep yok' USING ERRCODE = 'P0002';
END
$fn$;

-- Talep yazışması (eskiden yeniye). Bulunamazsa P0002.
CREATE FUNCTION wms_probe.platform_support_messages(p_ticket uuid)
RETURNS TABLE (id uuid, author_kind text, body text, created_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev text;
  v_tid uuid;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_support_messages: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR v_tid IN SELECT t.id FROM public.tenants t WHERE NOT t.is_demo LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', v_tid::text, true);
    IF EXISTS (SELECT 1 FROM public.support_tickets s WHERE s.tenant_id = v_tid AND s.id = p_ticket) THEN
      RETURN QUERY
        SELECT m.id, m.author_kind, m.body, m.created_at FROM public.support_ticket_messages m
         WHERE m.tenant_id = v_tid AND m.ticket_id = p_ticket ORDER BY m.created_at, m.id;
      PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
      RETURN;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  RAISE EXCEPTION 'platform_support_messages: talep yok' USING ERRCODE = 'P0002';
END
$fn$;

-- Operatör yanıtı: mesaj + durum ANSWERED + yanıt damgası; kapalı talebe yazılmaz (55000). Dönüş: mesaj kimliği.
CREATE FUNCTION wms_probe.platform_support_reply(p_ticket uuid, p_body text) RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_prev text;
  v_tid uuid;
  v_status text;
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_msg uuid;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_support_reply: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  IF pg_catalog.length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'platform_support_reply: metin biçimsiz' USING ERRCODE = '22023';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR v_tid IN SELECT t.id FROM public.tenants t WHERE NOT t.is_demo LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', v_tid::text, true);
    SELECT s.status INTO v_status FROM public.support_tickets s WHERE s.tenant_id = v_tid AND s.id = p_ticket FOR UPDATE;
    IF FOUND THEN
      IF v_status = 'CLOSED' THEN
        PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
        RAISE EXCEPTION 'platform_support_reply: talep kapalı' USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.support_ticket_messages (tenant_id, ticket_id, author_kind, author_user_id, body)
      VALUES (v_tid, p_ticket, 'OPERATOR', v_uid, v_body) RETURNING support_ticket_messages.id INTO v_msg;
      UPDATE public.support_tickets s SET status = 'ANSWERED', operator_replied_at = now()
       WHERE s.tenant_id = v_tid AND s.id = p_ticket;
      PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
      INSERT INTO public.security_events (user_id, event_type, detail)
      VALUES (v_uid, 'platform.support.replied',
              pg_catalog.jsonb_build_object('tenant_id', v_tid::text, 'ticket_id', p_ticket::text, 'message_id', v_msg::text));
      RETURN v_msg;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  RAISE EXCEPTION 'platform_support_reply: talep yok' USING ERRCODE = 'P0002';
END
$fn$;

-- Operatör durum değişikliği: yalnız OPEN ya da CLOSED (ANSWERED yalnız yanıtla). Değişmediyse false.
CREATE FUNCTION wms_probe.platform_support_set_status(p_ticket uuid, p_status text) RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_prev text;
  v_tid uuid;
  v_status text;
BEGIN
  IF NOT wms_probe.platform_is_operator() THEN
    RAISE EXCEPTION 'platform_support_set_status: operatör değil' USING ERRCODE = '42501';
  END IF;
  v_uid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  IF p_status IS NULL OR p_status NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'platform_support_set_status: durum biçimsiz' USING ERRCODE = '22023';
  END IF;
  v_prev := pg_catalog.current_setting('app.current_tenant_id', true);
  FOR v_tid IN SELECT t.id FROM public.tenants t WHERE NOT t.is_demo LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', v_tid::text, true);
    SELECT s.status INTO v_status FROM public.support_tickets s WHERE s.tenant_id = v_tid AND s.id = p_ticket FOR UPDATE;
    IF FOUND THEN
      IF v_status = p_status THEN
        PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
        RETURN false;
      END IF;
      UPDATE public.support_tickets s SET status = p_status WHERE s.tenant_id = v_tid AND s.id = p_ticket;
      PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
      INSERT INTO public.security_events (user_id, event_type, detail)
      VALUES (v_uid, 'platform.support.status',
              pg_catalog.jsonb_build_object('tenant_id', v_tid::text, 'ticket_id', p_ticket::text, 'from', v_status, 'to', p_status));
      RETURN true;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', coalesce(v_prev, ''), true);
  RAISE EXCEPTION 'platform_support_set_status: talep yok' USING ERRCODE = 'P0002';
END
$fn$;

REVOKE ALL ON FUNCTION wms_probe.platform_support_list(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_support_open_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_support_get(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_support_messages(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_support_reply(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wms_probe.platform_support_set_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_probe.platform_support_list(text, uuid, integer) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_support_open_count() TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_support_get(uuid) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_support_messages(uuid) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_support_reply(uuid, text) TO wms_app;
GRANT EXECUTE ON FUNCTION wms_probe.platform_support_set_status(uuid, text) TO wms_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA wms_probe FROM wms_identity_probe;

-- ---------------------------------------------------------------------------------------------
-- Doğrulama
-- ---------------------------------------------------------------------------------------------
DO $verify$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform_support_list', 'platform_support_open_count', 'platform_support_get', 'platform_support_messages',
                           'platform_support_reply', 'platform_support_set_status'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'wms_probe' AND p.proname = f AND p.prosecdef AND p.proowner = 'wms_identity_probe'::regrole
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION '0054_support_tickets: % beklenen biçimde değil', f;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('wms_app', 'public.support_tickets', 'DELETE')
     OR pg_catalog.has_table_privilege('wms_app', 'public.support_ticket_messages', 'DELETE')
     OR pg_catalog.has_any_column_privilege('wms_app', 'public.support_ticket_messages', 'UPDATE')
     OR pg_catalog.has_column_privilege('wms_app', 'public.support_tickets', 'operator_replied_at', 'UPDATE')
     OR pg_catalog.has_any_column_privilege('wms_auth', 'public.support_tickets', 'SELECT')
     OR pg_catalog.has_any_column_privilege('wms_worker', 'public.support_tickets', 'SELECT')
     OR pg_catalog.has_any_column_privilege('wms_auth', 'public.support_ticket_messages', 'SELECT')
     OR pg_catalog.has_any_column_privilege('wms_worker', 'public.support_ticket_messages', 'SELECT') THEN
    RAISE EXCEPTION '0054_support_tickets: yetki beklenenden geniş';
  END IF;
END
$verify$;
