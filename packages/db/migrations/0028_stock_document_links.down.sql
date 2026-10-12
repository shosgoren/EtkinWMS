-- Refuse to lose an operation's trace during rollback.
DO $check$ BEGIN
 IF EXISTS (SELECT 1 FROM public.stock_document_links) THEN
  RAISE EXCEPTION '0028: linked stock history exists; rollback would lose trace';
 END IF;
END $check$;
DROP TABLE public.stock_document_links;
