# TrueBalance cloud sync setup

1. Create a free project at https://supabase.com and wait for it to finish setting up.
2. Open **SQL Editor**, paste the contents of `supabase-schema.sql`, and choose **Run**.
3. Open **Project Settings → API**. Copy the **Project URL** and the public **anon/publishable key** into `config.js`.
4. Upload the entire TrueBalance app folder to your web host again. Cloud sign-in does not work reliably from a `file:///` address; use an HTTPS website or packaged iPhone app.
5. Open TrueBalance, then go to **Settings & data → Cloud sync**. Create an account on the first device and sign in with the same email on every other device.

Only use the public anon/publishable key in the app. Never put the Supabase `service_role` secret in `config.js`.

TrueBalance continues saving locally when offline. Signed-in changes upload automatically when a connection is available, and the newest saved copy is loaded when the app opens on another device. **Download cloud copy** forces the cloud version to replace the current device copy, so export a backup before using it when unsure.
