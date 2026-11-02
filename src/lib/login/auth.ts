import { AuthSessionMissingError, isAuthError } from "@supabase/supabase-js";
import { authStorageKey, supabase, throwawayClient } from "@/lib/supabase/client";

export type LoginClient = ReturnType<typeof throwawayClient>;

const NOT_REGISTERED = "המספר לא רשום במערכת";
const TOO_MANY = "נשלחו יותר מדי בקשות. צריך לחכות קצת.";
/** The Before User Created hook's answer for a number not in login_phones. It comes with no error code. */
const NOT_LISTED = "phone_not_allowed";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "מספר או סיסמה לא נכונים",
  otp_expired: "הקוד לא נכון או שפג תוקפו", // Supabase's one code for a wrong code and a late one
  over_sms_send_rate_limit: TOO_MANY,
  over_request_rate_limit: TOO_MANY,
  otp_disabled: NOT_REGISTERED, // an unknown number with shouldCreateUser off
  signup_disabled: NOT_REGISTERED,
  phone_not_confirmed: "המספר עדיין לא אומת",
  validation_failed: "המספר לא תקין",
  user_banned: "המשתמש חסום",
  weak_password: "הסיסמה קצרה מדי",
  sms_send_failed: "ההודעה לא נשלחה. צריך לבדוק את הגדרות ה-SMS.",
  phone_provider_disabled: "כניסה בטלפון כבויה",
};

/** Faults in the project's setup, not in what the person typed. The reason only shows in the console. */
const SETUP_FAULTS = new Set(["sms_send_failed", "phone_provider_disabled"]);

/** A short Hebrew sentence for a failed login step; anything unexpected also goes to the console. */
export function loginErrorMessage(error: unknown): string {
  if (isAuthError(error) && error.message === NOT_LISTED) return NOT_REGISTERED;
  const code = (isAuthError(error) && error.code) || "";
  const message = MESSAGES[code];
  if (message && !SETUP_FAULTS.has(code)) return message;
  console.error("Login failed:", error);
  if (message) return message;
  // Status 0 only: auth-js raises the same "retryable" error class for Supabase's own 5xx answers.
  const offline = isAuthError(error) && error.status === 0;
  return offline ? "אין חיבור לאינטרנט" : "משהו השתבש. אפשר לנסות שוב.";
}

/** True when Supabase refused the code itself, so the field should clear. */
export function isWrongCode(error: unknown): boolean {
  return isAuthError(error) && error.code === "otp_expired";
}

/** Proves the password, then revokes the session it opened: only the SMS code may lead in. */
export async function checkPassword(client: LoginClient, phone: string, password: string): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ phone, password });
  if (error) throw error;
  const { error: revokeError } = await client.auth.signOut({ scope: "local" });
  if (revokeError) throw revokeError;
}

/** Sends the SMS. Only the first-time path may create a user. */
export async function sendCode(client: LoginClient, phone: string, createUser: boolean): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: createUser } });
  if (error) throw error;
}

/** Checks the code; on success the session sits on the throwaway client. */
export async function verifyCode(client: LoginClient, phone: string, token: string): Promise<void> {
  const { error } = await client.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) throw error;
}

/** Sets the password. `same_password` only means the person chose the one they already have. */
export async function choosePassword(client: LoginClient, password: string): Promise<void> {
  const { error } = await client.auth.updateUser({ password });
  if (error && error.code !== "same_password") throw error;
}

/** Moves the session to the real client, which opens the app, and drops the throwaway client. */
export async function handOver(client: LoginClient): Promise<void> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new AuthSessionMissingError();
  const { access_token, refresh_token } = data.session;
  const { error: setError } = await supabase().auth.setSession({ access_token, refresh_token });
  if (setError) throw setError;
  await client.auth.dispose();
}

/** Ends the session on this device; AuthGate then shows the login. */
export async function logOut(): Promise<void> {
  const { error } = await supabase().auth.signOut({ scope: "local" });
  if (!error) return;
  console.error("Logout failed:", error);
  // Offline with an expired token, signOut stops at the failed refresh and keeps the session.
  // Once the stored session is gone it finishes locally and tells AuthGate, so nothing stays open.
  window.localStorage.removeItem(authStorageKey());
  const { error: localError } = await supabase().auth.signOut({ scope: "local" });
  if (localError) throw localError;
}
