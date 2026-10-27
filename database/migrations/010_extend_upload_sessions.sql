-- Keep resumable Drive uploads alive long enough for large files on slow networks.
ALTER TABLE public.organization_uploads
  ALTER COLUMN expires_at SET DEFAULT now() + interval '24 hours';

UPDATE public.organization_uploads
SET expires_at = now() + interval '24 hours'
WHERE expires_at > now()
  AND expires_at < now() + interval '24 hours';
