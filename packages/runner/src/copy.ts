/**
 * Every word the runner itself draws, in the languages it ships.
 *
 * WHY ONE TABLE. The gate, the pill, the account labels, the not-found page
 * and the session errors all draw words; written where they are drawn, they
 * would drift between languages. One table per language, and the same keys in
 * both, is what a test can hold in step.
 *
 * The app's own content is not here: that is authored in the receipts. These
 * are the runner's words, around the content.
 *
 * @module @pwfabric/runner/copy
 */

/** The content locales a published app is delivered in. */
export type RunnerLocale = 'en' | 'tr'

/**
 * The `?auth_error=` codes the gateway and the API send a visitor back with.
 *
 * Anything else is still shown — as the generic sentence with the code quoted,
 * so a new code on the server never renders as silence. Matched without
 * regard to case: the API and gateway send them uppercase (`ACCESS_DENIED`).
 * The gateway's own `SIGN_IN_FAILED` and `PROVIDER_REFUSED` are aliases.
 */
export const AUTH_ERROR_CODES = [
  'access_denied',
  'invalid_request',
  'invalid_state',
  'expired',
  'provider_error',
  'method_unavailable',
  'server_error',
] as const

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number]

/** The labels a sign-in button can carry. */
export type ProviderLabelKey = 'password' | 'phiwebs' | 'microsoft' | 'google' | 'github'

export interface RunnerCopy {
  readonly gate: {
    /** Used when the project has no title. */
    readonly title: string
    readonly body: string
    readonly email: string
    readonly password: string
    readonly name: string
    readonly signIn: string
    readonly register: string
    readonly toRegister: string
    readonly toSignIn: string
    readonly or: string
    readonly close: string
    readonly noProvider: string
    readonly providers: Readonly<Record<ProviderLabelKey, string>>
  }
  readonly pill: {
    readonly signedIn: string
    readonly signIn: string
    readonly signOut: string
  }
  /** The labels injected into the shell's account slot. */
  readonly account: {
    readonly signIn: string
    readonly signOut: string
    readonly profile: string
    /** The greeting's name when the visitor has neither a name nor an email. */
    readonly fallbackName: string
  }
  readonly notFound: {
    readonly title: string
    readonly body: string
    readonly home: string
  }
  /** The password door (`app-session.ts`). */
  readonly session: {
    readonly unreachable: string
    readonly unexpected: string
    readonly failed: string
  }
  /** The external issuer's PKCE bridge (`auth.ts`). */
  readonly bridge: {
    readonly exchangeFailed: string
    readonly invalidCallback: string
    readonly issuerUnreachable: string
  }
  readonly authErrors: Readonly<Record<AuthErrorCode | 'generic', string>>
}

const EN: RunnerCopy = {
  gate: {
    title: 'Sign in',
    body: 'You need to sign in to view this app.',
    email: 'Email',
    password: 'Password',
    name: 'Name',
    signIn: 'Sign in',
    register: 'Sign up',
    toRegister: "Don't have an account? Sign up",
    toSignIn: 'Already have an account? Sign in',
    or: 'or',
    close: 'Close',
    noProvider: 'This app requires sign-in, but no identity provider is configured.',
    providers: {
      password: 'Email and password',
      phiwebs: 'Continue with your account',
      microsoft: 'Continue with Microsoft',
      google: 'Continue with Google',
      github: 'Continue with GitHub',
    },
  },
  pill: {
    signedIn: 'Signed in',
    signIn: 'Sign in',
    signOut: 'Sign out',
  },
  account: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    profile: 'Profile',
    fallbackName: 'User',
  },
  notFound: {
    title: 'Page not found',
    body: 'This address does not name a page in this app.',
    home: 'Go to the home page',
  },
  session: {
    unreachable: 'Could not reach the server. Check your connection.',
    unexpected: 'The server sent an unexpected response.',
    failed: 'Could not sign in.',
  },
  bridge: {
    exchangeFailed: 'Could not sign in: the token exchange failed. Details are in the console.',
    invalidCallback: 'This sign-in link is invalid or has expired. Try again.',
    issuerUnreachable: 'Could not reach the sign-in provider. Try again.',
  },
  authErrors: {
    access_denied: 'Sign-in was cancelled or refused by the provider.',
    invalid_request: 'The sign-in request was not valid. Try again.',
    invalid_state: 'This sign-in attempt was not recognised. Try again.',
    expired: 'This sign-in attempt has expired. Try again.',
    provider_error: 'The sign-in provider returned an error. Try again later.',
    method_unavailable: 'This sign-in method is not available for this app.',
    server_error: 'Sign-in could not be completed. Try again later.',
    generic: 'Sign-in failed. Try again.',
  },
}

const TR: RunnerCopy = {
  gate: {
    title: 'Oturum açın',
    body: 'Bu uygulamayı görüntülemek için oturum açmanız gerekiyor.',
    email: 'E-posta',
    password: 'Parola',
    name: 'Ad',
    signIn: 'Oturum aç',
    register: 'Kayıt ol',
    toRegister: 'Hesabınız yok mu? Kayıt olun',
    toSignIn: 'Zaten hesabınız var mı? Oturum açın',
    or: 'ya da',
    close: 'Kapat',
    noProvider: 'Bu uygulama oturum açma gerektiriyor ama bir kimlik sağlayıcı tanımlanmamış.',
    providers: {
      password: 'E-posta ve parola',
      phiwebs: 'Hesabınızla devam edin',
      microsoft: 'Microsoft ile devam et',
      google: 'Google ile devam et',
      github: 'GitHub ile devam et',
    },
  },
  pill: {
    signedIn: 'Oturum açık',
    signIn: 'Oturum aç',
    signOut: 'Çıkış',
  },
  account: {
    signIn: 'Oturum aç',
    signOut: 'Çıkış yap',
    profile: 'Profil',
    fallbackName: 'Kullanıcı',
  },
  notFound: {
    title: 'Sayfa bulunamadı',
    body: 'Bu adres, bu uygulamada bir sayfaya karşılık gelmiyor.',
    home: 'Ana sayfaya git',
  },
  session: {
    unreachable: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.',
    unexpected: 'Sunucudan beklenmeyen bir yanıt geldi.',
    failed: 'Oturum açılamadı.',
  },
  bridge: {
    exchangeFailed: 'Oturum açılamadı: jeton değişimi başarısız. Ayrıntı konsolda.',
    invalidCallback: 'Oturum açma bağlantısı geçersiz ya da süresi geçmiş. Tekrar deneyin.',
    issuerUnreachable: 'Oturum açma sağlayıcısına ulaşılamadı. Tekrar deneyin.',
  },
  authErrors: {
    access_denied: 'Giriş iptal edildi ya da sağlayıcı tarafından reddedildi.',
    invalid_request: 'Giriş isteği geçerli değildi. Tekrar deneyin.',
    invalid_state: 'Bu giriş denemesi tanınmadı. Lütfen tekrar deneyin.',
    expired: 'Bu giriş denemesinin süresi doldu. Tekrar deneyin.',
    provider_error: 'Giriş sağlayıcısı bir hata döndürdü. Daha sonra tekrar deneyin.',
    method_unavailable: 'Bu giriş yöntemi bu uygulamada kullanılamıyor.',
    server_error: 'Giriş tamamlanamadı. Daha sonra tekrar deneyin.',
    generic: 'Giriş başarısız oldu. Tekrar deneyin.',
  },
}

export const RUNNER_COPY: Readonly<Record<RunnerLocale, RunnerCopy>> = { en: EN, tr: TR }

/** The table for a locale; anything the runner does not ship reads English. */
export function copyFor(locale: string | null | undefined): RunnerCopy {
  return locale === 'tr' ? TR : EN
}

/** A code short and plain enough to quote to a visitor. */
const QUOTABLE = /^[a-z0-9_]{1,64}$/i

/**
 * The sentence for an `?auth_error=` code.
 *
 * An unknown code is not hidden: it becomes the generic sentence with the code
 * in brackets, which is what an operator needs to find the cause. A value that
 * is not a plain identifier is not echoed at all — it came off the address bar.
 */
export function authErrorMessage(locale: string | null | undefined, code: string): string {
  const table = copyFor(locale).authErrors
  const known = authErrorCodeOf(code)
  if (known) return table[known]
  return QUOTABLE.test(code) ? `${table.generic} (${code})` : table.generic
}

/**
 * The gateway's own fallback codes, read as the sentence that fits them. The
 * gateway answers these when the API gave it nothing it may forward.
 */
const AUTH_ERROR_ALIASES: Readonly<Record<string, AuthErrorCode>> = {
  sign_in_failed: 'server_error',
  provider_refused: 'access_denied',
}

/**
 * A code in any case, as one of ours — or null.
 *
 * The API and the gateway send `ACCESS_DENIED`; the table is keyed
 * `access_denied`. Both are the same code, so the comparison is on lowercase.
 */
function authErrorCodeOf(code: string): AuthErrorCode | null {
  const key = code.toLowerCase()
  if ((AUTH_ERROR_CODES as readonly string[]).includes(key)) return key as AuthErrorCode
  return Object.prototype.hasOwnProperty.call(AUTH_ERROR_ALIASES, key)
    ? (AUTH_ERROR_ALIASES[key] as AuthErrorCode)
    : null
}
