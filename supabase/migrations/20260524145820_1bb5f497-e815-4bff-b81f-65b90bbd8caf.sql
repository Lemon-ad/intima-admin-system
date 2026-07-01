-- Remove unused server-side password hashes (client uses hardcoded hashes); they were publicly readable.
DELETE FROM public.app_settings WHERE key = 'auth_shared_hashes';

-- Drop the unused verify_shared_password SECURITY DEFINER function that read those hashes.
DROP FUNCTION IF EXISTS public.verify_shared_password(text);