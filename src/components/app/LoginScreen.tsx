"use client";

/**
 * כניסה, in place of the app. With a password: phone and password, then a code by SMS.
 * First time or a forgotten password: phone, code, then a new password.
 * Every step runs on a throwaway client; the real client gets the session only at the very end.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactElement, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { Input, type InputProps } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Select, type SelectOption } from "@/components/ui/Select";
import { checkPassword, choosePassword, handOver, isWrongCode, loginErrorMessage, sendCode, verifyCode, type LoginClient } from "@/lib/login/auth";
import { ISRAEL, allCountries, toInternational, type Country } from "@/lib/login/countries";
import { throwawayClient } from "@/lib/supabase/client";
import "./login.css";

type Step = "credentials" | "first-time" | "code" | "new-password";
/** The screens that send a code: "שינוי מספר" returns there, and it decides what follows the code. */
type Start = "credentials" | "first-time";
type FieldErrors = { phone?: string; password?: string; code?: string };
type FieldRef = RefObject<HTMLInputElement | null>;

const CODE_LENGTH = 6;
const MIN_PHONE_DIGITS = 6;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // Supabase refuses longer, counting bytes: a Hebrew letter takes two
const RESEND_SECONDS = 60;
const LRM = "‎"; // keeps the plus beside its digits inside Hebrew text

const TITLE: Record<Step, string> = {
  credentials: "כניסה",
  "first-time": "כניסה ראשונה",
  code: "קוד אימות",
  "new-password": "בחירת סיסמה",
};

const SUBMIT: Record<Step, string> = {
  credentials: "שליחת קוד",
  "first-time": "שליחת קוד",
  code: "כניסה",
  "new-password": "שמירה וכניסה",
};

function newPasswordError(password: string): string | undefined {
  if (password.length < MIN_PASSWORD) return "לפחות 8 תווים";
  return new TextEncoder().encode(password).length > MAX_PASSWORD ? "הסיסמה ארוכה מדי" : undefined;
}

interface PhoneFieldProps {
  countries: Country[];
  country: Country;
  number: string;
  error?: string;
  busy: boolean;
  inputRef: FieldRef;
  onCountry: (country: Country) => void;
  onNumber: (number: string) => void;
}

/** Numbers read left to right even in Hebrew: country on the left, number on the right. */
function PhoneField({ countries, country, number, error, busy, inputRef, onCountry, onNumber }: PhoneFieldProps): ReactElement {
  const options = useMemo<SelectOption[]>(
    // The code comes first: on a long name the trigger's ellipsis then falls on the name.
    () => countries.map((c) => ({ value: c.iso, label: `${LRM}+${c.dial} ${c.name}` })),
    [countries],
  );
  return (
    <div className="sa-field">
      <label id="app-login-phone-label" className="sa-label" htmlFor="app-login-number">מספר טלפון</label>
      <div className="app-login-phone" dir="ltr" role="group" aria-labelledby="app-login-phone-label">
        <Select
          options={options}
          value={country.iso}
          minWidth={0}
          disabled={busy}
          searchPlaceholder="חיפוש לפי מדינה או קידומת"
          emptyLabel="לא נמצאו מדינות"
          onChange={(iso) => {
            const picked = countries.find((c) => c.iso === iso);
            if (picked) onCountry(picked);
          }}
        />
        <Input
          ref={inputRef}
          id="app-login-number"
          className="app-login-number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          value={number}
          readOnly={busy}
          error={error}
          onChange={(e) => onNumber(e.target.value)}
        />
      </div>
    </div>
  );
}

function PasswordField({ inputRef, ...input }: InputProps & { inputRef: FieldRef }): ReactElement {
  const [shown, setShown] = useState(false);
  return (
    <Input
      {...input}
      ref={inputRef}
      className="app-login-secret"
      label="סיסמה"
      name="password"
      type={shown ? "text" : "password"}
      end={
        <Button variant="link" aria-label={shown ? "הסתרת סיסמה" : "הצגת סיסמה"} onClick={() => setShown((s) => !s)}>
          {shown ? "הסתרה" : "הצגה"}
        </Button>
      }
    />
  );
}

/**
 * The six places of the code, drawn over one real input: pasting, the SMS autofill and the keyboard stay the browser's.
 * Only the aluminium style shows them; the classic style keeps the input's own text.
 */
function CodeSlots({ code }: { code: string }): ReactElement {
  return (
    <span className="app-login-slots" aria-hidden="true">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <span key={i} className={i === code.length ? "app-login-slot is-next" : "app-login-slot"}>
          {code[i] ? <span className="app-login-digit">{code[i]}</span> : null}
        </span>
      ))}
    </span>
  );
}

export function LoginScreen(): ReactElement {
  const [step, setStep] = useState<Step>("credentials");
  const [start, setStart] = useState<Start>("credentials");
  const [country, setCountry] = useState<Country>(ISRAEL);
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [wait, setWait] = useState(0);

  const phoneRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef<LoginClient | null>(null);
  const verifiedRef = useRef(false);
  const sentToRef = useRef("");
  const busyRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetHeightRef = useRef(0);

  const countries = useMemo(() => allCountries(), []);
  const phone = toInternational(country.dial, number);

  // Every screen opens on its first field.
  useEffect(() => {
    const field = step === "code" ? codeRef : step === "new-password" ? passwordRef : phoneRef;
    field.current?.focus();
  }, [step]);

  // The sheet eases to its next height, which CSS cannot do from auto. Clipped meanwhile: taller content waits inside it.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const from = sheetHeightRef.current;
    const to = sheet.offsetHeight;
    sheetHeightRef.current = to;
    if (!from || from === to) return;
    // Length and curve are the stylesheet's, in computed form: always seconds, and none in the classic style.
    const { transitionDuration, transitionTimingFunction } = getComputedStyle(sheet);
    const duration = parseFloat(transitionDuration) * 1000;
    if (!duration) return;
    sheet.animate(
      { height: [`${from}px`, `${to}px`], overflow: ["clip", "clip"] },
      { duration, easing: transitionTimingFunction },
    );
  }, [step, notice, errors]);

  // Counts from the clock: timers stall while the person reads the SMS in another app.
  useEffect(() => {
    if (!resendAt) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setWait(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  // A flow abandoned mid-way, or one that just opened the app, leaves no client behind.
  useEffect(() => () => void clientRef.current?.auth.dispose(), []);

  const flowClient = () => (clientRef.current ??= throwawayClient());

  const freshClient = () => {
    void clientRef.current?.auth.dispose();
    clientRef.current = null;
    verifiedRef.current = false;
    return flowClient();
  };

  /** One call at a time; whatever it throws becomes the notice. */
  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice(loginErrorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** The phone and country stay; the password and the code never carry over to another screen. */
  const moveTo = (next: Step) => {
    setStep(next);
    setPassword("");
    setCode("");
    setErrors({});
    setNotice(null);
  };

  const edited = (field: keyof FieldErrors) => {
    setErrors((e) => ({ ...e, [field]: undefined }));
    setNotice(null);
  };

  const startWait = () => {
    setResendAt(Date.now() + RESEND_SECONDS * 1000);
    setWait(RESEND_SECONDS);
  };

  const startFlow = (from: Start) => run(async () => {
    const client = freshClient();
    if (from === "credentials") await checkPassword(client, phone, password);
    // Same number inside the wait: Supabase would refuse, and the code already sent still works.
    if (wait === 0 || phone !== sentToRef.current) {
      await sendCode(client, phone, from === "first-time");
      sentToRef.current = phone;
      startWait();
    }
    setStart(from);
    moveTo("code");
  });

  const resend = () => run(async () => {
    await sendCode(flowClient(), phone, start === "first-time");
    verifiedRef.current = false; // the new code is the one to check
    setCode("");
    setErrors({});
    startWait();
    codeRef.current?.focus();
  });

  const enterCode = (token: string) => run(async () => {
    const client = flowClient();
    // A code works once, so a retry after a failed hand-over must not check it again.
    if (!verifiedRef.current) {
      try {
        await verifyCode(client, phone, token);
      } catch (error) {
        if (isWrongCode(error)) {
          setCode("");
          codeRef.current?.focus();
        }
        throw error;
      }
      verifiedRef.current = true;
    }
    if (start === "first-time") moveTo("new-password");
    else await handOver(client);
  });

  const savePassword = () => run(async () => {
    const client = flowClient();
    await choosePassword(client, password);
    await handOver(client);
  });

  const typeCode = (typed: string) => {
    const digits = typed.replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (digits === code) return;
    edited("code");
    setCode(digits);
    if (digits.length === CODE_LENGTH) void enterCode(digits);
  };

  const missing = (): FieldErrors => {
    const noPhone = phone.length - country.dial.length - 1 < MIN_PHONE_DIGITS ? "חסר מספר טלפון" : undefined;
    switch (step) {
      case "credentials": return { phone: noPhone, password: password ? undefined : "חסרה סיסמה" };
      case "first-time": return { phone: noPhone };
      case "code": return { code: code.length === CODE_LENGTH ? undefined : "חסר קוד" };
      case "new-password": return { password: newPasswordError(password) };
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = missing();
    setErrors(found);
    const field = found.phone ? phoneRef : found.password ? passwordRef : found.code ? codeRef : null;
    if (field) field.current?.focus();
    else if (step === "code") void enterCode(code);
    else if (step === "new-password") void savePassword();
    else void startFlow(step);
  };

  return (
    <main className="app-login">
      <div className="app-login-column">
        <p className="app-login-brand">ניהול מלאי</p>
        <div ref={sheetRef} className="app-login-sheet">
          <div key={step} className="app-login-step">
            <h1 className="sa-page-title">{TITLE[step]}</h1>
            {step === "first-time" ? <p className="sa-page-sub">קוד ב-SMS, ואז בוחרים סיסמה</p> : null}
            {step === "code" ? <p className="sa-page-sub">נשלח אל <span className="sa-num">{phone}</span></p> : null}
            {step === "new-password" ? <p className="sa-page-sub">לפחות 8 תווים</p> : null}

            <form className="app-login-form" onSubmit={submit}>
              {step === "credentials" || step === "first-time" ? (
                <PhoneField
                  countries={countries}
                  country={country}
                  number={number}
                  error={errors.phone}
                  busy={busy}
                  inputRef={phoneRef}
                  onCountry={(c) => {
                    setCountry(c);
                    edited("phone");
                  }}
                  onNumber={(n) => {
                    setNumber(n);
                    edited("phone");
                  }}
                />
              ) : null}

              {step === "credentials" ? (
                <PasswordField
                  inputRef={passwordRef}
                  autoComplete="current-password"
                  value={password}
                  readOnly={busy}
                  error={errors.password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    edited("password");
                  }}
                />
              ) : null}

              {step === "code" ? (
                <Input
                  ref={codeRef}
                  className="app-login-code"
                  name="code"
                  aria-label="קוד אימות"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  readOnly={busy}
                  error={errors.code}
                  end={<CodeSlots code={code} />}
                  onChange={(e) => typeCode(e.target.value)}
                />
              ) : null}

              {step === "new-password" ? (
                <>
                  {/* Tells a password manager which user this new password belongs to. */}
                  <input type="text" name="phone" autoComplete="username" value={number} readOnly hidden />
                  <PasswordField
                    inputRef={passwordRef}
                    autoComplete="new-password"
                    maxLength={MAX_PASSWORD}
                    value={password}
                    readOnly={busy}
                    error={errors.password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      edited("password");
                    }}
                  />
                </>
              ) : null}

              {notice ? <Notice tone="danger">{notice}</Notice> : null}

              <Button type="submit" className="app-login-submit" isLoading={busy}>{SUBMIT[step]}</Button>

              {step === "credentials" ? (
                <div className="app-login-links">
                  <Button variant="link" disabled={busy} onClick={() => moveTo("first-time")}>כניסה ראשונה או סיסמה חדשה</Button>
                </div>
              ) : null}

              {step === "first-time" ? (
                <div className="app-login-links">
                  <Button variant="link" disabled={busy} onClick={() => moveTo("credentials")}>חזרה לכניסה</Button>
                </div>
              ) : null}

              {step === "code" ? (
                <div className="app-login-links">
                  <Button variant="link" disabled={busy || wait > 0} onClick={() => void resend()}>
                    {wait > 0 ? `קוד חדש בעוד ${wait}` : "שליחת קוד חדש"}
                  </Button>
                  <Button variant="link" disabled={busy} onClick={() => moveTo(start)}>שינוי מספר</Button>
                </div>
              ) : null}
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
