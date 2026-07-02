"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { linkLineAction, type LinkLineState } from "./actions";

const initialState: LinkLineState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="login-submit">
      {pending ? (
        <>
          <span className="login-spinner" aria-hidden />
          <span>ກຳລັງເຊື່ອມ...</span>
        </>
      ) : (
        <>
          <span>ເຊື່ອມ ແລະ ເຂົ້າສູ່ລະບົບ</span>
          <span aria-hidden>→</span>
        </>
      )}
    </button>
  );
}

export default function LinkLineForm() {
  const [state, formAction] = useActionState(linkLineAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="login-form">
      <div className="login-field">
        <label htmlFor="code" className="login-field-label">
          ລະຫັດພະນັກງານ
        </label>
        <div className="login-field-control">
          <input
            id="code"
            name="code"
            type="text"
            autoComplete="username"
            required
            className="login-input"
            placeholder="ເຊັ່ນ 22027"
          />
        </div>
      </div>

      <div className="login-field">
        <label htmlFor="password" className="login-field-label">
          ລະຫັດຜ່ານ
        </label>
        <div className="login-field-control">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="login-input"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="login-eye"
            aria-label={showPassword ? "ເຊື່ອງລະຫັດ" : "ສະແດງລະຫັດ"}
          >
            {showPassword ? "🙈" : "👁"}
          </button>
        </div>
      </div>

      {state.error ? <div className="login-error">{state.error}</div> : null}

      <SubmitButton />

      <a href="/login" className="login-foot-help" style={{ textAlign: "center" }}>
        ← ກັບໄປໜ້າເຂົ້າສູ່ລະບົບປົກກະຕິ
      </a>
    </form>
  );
}
