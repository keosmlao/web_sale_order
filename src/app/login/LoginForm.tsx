"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="login-submit"
    >
      {pending ? (
        <>
          <span className="login-spinner" aria-hidden />
          <span>ກຳລັງເຂົ້າລະບົບ...</span>
        </>
      ) : (
        <>
          <span>ເຂົ້າສູ່ລະບົບ</span>
          <span aria-hidden>→</span>
        </>
      )}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="login-form">
      <div className="login-field">
        <label htmlFor="code" className="login-field-label">
          ລະຫັດພະນັກງານ
        </label>
        <div className="login-field-control">
          <span className="login-field-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="12" cy="10" r="2.5" />
              <path d="M7.5 17.5c.8-2 2.5-3 4.5-3s3.7 1 4.5 3" />
            </svg>
          </span>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            required
            autoFocus
            placeholder="ໃສ່ລະຫັດພະນັກງານ"
            className="login-input"
          />
        </div>
      </div>

      <div className="login-field">
        <label htmlFor="password" className="login-field-label">
          ລະຫັດຜ່ານ
        </label>
        <div className="login-field-control">
          <span className="login-field-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="ໃສ່ລະຫັດຜ່ານ"
            className="login-input"
          />
          <button
            type="button"
            className="login-eye"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "ເຊື່ອງລະຫັດຜ່ານ" : "ສະແດງລະຫັດຜ່ານ"}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l18 18" />
                <path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c5 0 9.3 3.2 10.5 6-.4 1-1.1 2-2.1 2.9M6.6 6.6C4.4 8 2.9 10 2.5 12c1.2 2.8 5.5 6 9.5 6 1.3 0 2.6-.3 3.7-.8" />
                <path d="M9.5 9.5a3.5 3.5 0 0 0 5 5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 12C3.7 9.2 8 6 12 6s8.3 3.2 9.5 6c-1.2 2.8-5.5 6-9.5 6S3.7 14.8 2.5 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {state.error && (
        <div className="login-error" role="alert">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 7v6" />
            <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
          </svg>
          <span>{state.error}</span>
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
