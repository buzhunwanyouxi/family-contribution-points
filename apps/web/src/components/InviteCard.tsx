import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { FamilyInviteView } from '../api/types';

/**
 * CONTRACTS #10b -- the "invite your family" card on P12.
 *
 * Two behaviours are deliberate and were agreed with the backend:
 *
 *  1. **A member without permission must not be told they are not a member.** The backend answers
 *     `403 role_not_allowed` (not `not_a_member`) precisely so this card can say "ask a parent to
 *     send it to you". If you ever collapse those two codes, this is the screen that breaks: a child
 *     would read "you are not a member of this family" and think the app lost their family.
 *  2. **An expired code is shown, not hidden.** The backend returns the code together with its past
 *     expiry so this card can explain itself instead of showing a bare error. Rotating a code is A7
 *     and is not implemented yet, so there is nothing better to offer.
 *
 * The QR library is behind a dynamic import: it is a few tens of KB that only this card needs, and
 * the app shell should not pay for it. Rendering happens into an <img> as a data URL, so the DOM
 * stays simple and the code can be long-pressed/saved like any other image.
 */
type QrState = { status: 'idle' | 'loading' | 'ready' | 'error'; dataUrl?: string };

export function InviteCard({ familyId, canShare }: { familyId: string; canShare: boolean }) {
  const [invite, setInvite] = useState<FamilyInviteView | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [qr, setQr] = useState<QrState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    // A member who may not share never calls the endpoint: it would only produce a 403 and a
    // pointless round trip. The role comes from the session, and the server enforces it anyway.
    if (!canShare) {
      setInvite(null);
      setError(null);
      return () => {
        alive.current = false;
      };
    }

    setLoading(true);
    setError(null);
    api
      .invite(familyId)
      .then((result) => {
        if (alive.current) setInvite(result);
      })
      .catch((err) => {
        if (!alive.current) return;
        if (err instanceof ApiError) setError({ message: err.message, code: err.body?.error });
        else setError({ message: (err as Error).message });
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });

    return () => {
      alive.current = false;
    };
  }, [familyId, canShare]);

  useEffect(() => {
    if (!invite) {
      setQr({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setQr({ status: 'loading' });
    import('qrcode')
      .then((mod) =>
        mod.toDataURL(invite.qrPayload, { margin: 1, width: 220, errorCorrectionLevel: 'M' }),
      )
      .then((dataUrl) => {
        if (!cancelled) setQr({ status: 'ready', dataUrl });
      })
      .catch(() => {
        if (!cancelled) setQr({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [invite]);

  const expired =
    invite?.inviteExpireAt !== null &&
    invite?.inviteExpireAt !== undefined &&
    new Date(invite.inviteExpireAt).getTime() < Date.now();

  async function copyCode() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError({ message: '复制失败,请长按下面的邀请码手动复制' });
    }
  }

  if (!canShare) {
    return (
      <section className="card">
        <h2>邀请家人加入</h2>
        <p className="card-note">
          只有家庭创建者可以分享邀请码,请让家长发给你。
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>邀请家人加入</h2>
      {loading && <p className="empty">加载中…</p>}

      {error && (
        <p className="error-box" role="alert">
          {error.code === 'role_not_allowed'
            ? '只有家庭创建者可以分享邀请码,请让家长发给你'
            : error.message}
        </p>
      )}

      {invite && (
        <>
          <p className="card-note">把这个邀请码发给家人,他们注册后填进去就能加入。</p>

          <div className="invite-code" aria-label="邀请码">
            {invite.inviteCode.split('').map((char, index) => (
              // eslint-disable-next-line react/no-array-index-key -- fixed-length code, order is identity
              <span className="invite-code-char" key={`${char}-${index}`}>
                {char}
              </span>
            ))}
          </div>

          <button type="button" className="btn btn-secondary" onClick={copyCode}>
            {copied ? '已复制 ✓' : '复制邀请码'}
          </button>

          {expired ? (
            <p className="error-box" role="alert">
              这个邀请码已经过期了,暂时无法重新生成(轮换功能还没做)。
            </p>
          ) : (
            invite.inviteExpireAt && (
              <p className="card-note">
                有效期到 {new Date(invite.inviteExpireAt).toLocaleDateString('zh-CN')}
              </p>
            )
          )}

          <div className="qr-box">
            {qr.status === 'ready' && qr.dataUrl && (
              <img src={qr.dataUrl} alt={`加入家庭的二维码,内容为 ${invite.qrPayload}`} />
            )}
            {qr.status === 'loading' && <p className="empty">正在生成二维码…</p>}
            {qr.status === 'error' && (
              <p className="card-note">二维码生成失败,直接发上面的邀请码也可以。</p>
            )}
          </div>
          <p className="card-note">让家人用手机相机扫这个码,会自动打开加入页面。</p>
        </>
      )}
    </section>
  );
}
