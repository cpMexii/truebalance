# TrueBalance cloud sync setup

1. Create a free project at https://supabase.com and wait for it to finish setting up.
2. Open **SQL Editor**, paste the contents of `supabase-schema.sql`, and choose **Run**.
3. Open **Project Settings → API**. Copy the **Project URL** and the public **anon/publishable key** into `config.js`.
4. Upload the entire TrueBalance app folder to your web host again. Cloud sign-in does not work reliably from a `file:///` address; use an HTTPS website or packaged iPhone app.
5. Open TrueBalance, then go to **Settings & data → Cloud sync**. Create an account on the first device and sign in with the same email on every other device.
6. In **Database → Publications → supabase_realtime**, confirm that the `budgets` table is enabled. The included SQL attempts to enable it automatically.

## Share a budget with another member

Run the newest `supabase-schema.sql` once to add household memberships and sharing codes. In TrueBalance, the owner opens **Settings & data → Share account**, creates a private code, and sends it to the trusted member. The member creates or signs into their own Cloud Sync account, enters the code under **Join another budget**, and receives full editing access. Never post a sharing code publicly. Creating a new code disables the previous invitation code.

Only use the public anon/publishable key in the app. Never put the Supabase `service_role` secret in `config.js`.

TrueBalance continues saving locally when offline. Signed-in changes upload automatically and open devices receive Realtime updates. Returning to the app triggers a cloud catch-up. **Download cloud copy** first preserves the current local data as a recovery copy, then loads the cloud version.
