"use client";

import { useState } from "react";
import { ActionButton, Panel } from "../shared";

type Fields = { company: string; name: string; email: string; phone: string; concern: string };
const empty: Fields = { company: "", name: "", email: "", phone: "", concern: "" };

export function JapIntro() {
  const [fields, setFields] = useState<Fields>(empty);
  const [errors, setErrors] = useState<Partial<Fields>>({});
  const [done, setDone] = useState(false);
  const set = (key: keyof Fields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFields(value => ({ ...value, [key]: event.target.value }));
    setErrors(value => ({ ...value, [key]: undefined }));
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Partial<Fields> = {};
    if (!fields.company.trim()) next.company = "会社名を入力してください。";
    if (!fields.name.trim()) next.name = "名前を入力してください。";
    if (!fields.email.trim()) next.email = "メールアドレスを入力してください。";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) next.email = "メールアドレスの形式が正しくありません。";
    if (!fields.phone.trim()) next.phone = "電話番号を入力してください。";
    setErrors(next);
    if (Object.keys(next).length === 0) setDone(true);
  };
  const field = (key: keyof Fields, label: string, required: boolean, type = "text", maxLength = 100) =>
    <label className="cs-label"><span>{label}{required && <em aria-hidden>*</em>}</span>
      <input className="cs-input" type={type} value={fields[key]} onChange={set(key)} maxLength={maxLength} required={required} aria-invalid={!!errors[key]} />
      {errors[key] && <span role="alert" className="auth-error">{errors[key]}</span>}</label>;
  return <div className="public-auth public-form"><Panel>
    {done ? <div className="cs-stack">
      <h1>送信が完了しました</h1>
      <p>ご入力いただきありがとうございます。担当者より順次ご連絡いたします。</p>
      <p className="cs-muted">この画面は出典先の公開申請画面を再現したローカルデモです。入力内容は保存されません。</p>
    </div> : <form className="cs-stack" onSubmit={submit} noValidate>
      <h1>[キャッチセキュー] 個人情報保護自動化サービス導入相談申請</h1>
      <p>個人情報の収集、管理、廃棄にお困りですか？キャッチセキューを利用すれば、手頃な価格で簡単に解決できます。以下の情報をご入力いただければ、担当者が迅速にご連絡いたします。</p>
      {field("company", "会社名(必須)", true)}
      {field("name", "名前(必須)", true)}
      {field("email", "メールアドレス(必須)", true, "email", 255)}
      {field("phone", "電話番号(必須)", true, "tel", 20)}
      <label className="cs-label"><span>個人情報に関するお悩み事 (任意)</span>
        <textarea className="cs-input" value={fields.concern} onChange={set("concern")} rows={4} maxLength={2000} /></label>
      <div className="public-actions"><ActionButton>提出する</ActionButton></div>
      <p className="cs-muted">ご入力いただいた個人情報は暗号化され、安全に管理されます。本フォームは個人情報管理ソリューション <strong>Catch Secu</strong> で作成されました。</p>
    </form>}
    <p className="public-powered">powered by Catchsecu</p>
  </Panel></div>;
}
