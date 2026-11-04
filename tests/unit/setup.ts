import { config } from "dotenv";
// Square sandbox credentials come from .env.local (never printed). Everything else is pinned for tests.
config({ path: ".env.local", quiet: true });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost/garment_test";
process.env.APP_URL = "http://localhost:3000";
process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "test-square-signature-key";
process.env.SQUARE_WEBHOOK_URL = "http://localhost:3000/api/webhooks/square";
delete process.env.UBER_CLIENT_ID; // force the mock adapter
delete process.env.RESEND_API_KEY;
delete process.env.TWILIO_ACCOUNT_SID;
