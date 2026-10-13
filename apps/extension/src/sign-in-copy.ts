/** Site sign-in wording shared by the background and the UI: the refusals a window may show. No
 * signing code, so the UI bundle can import it. */
export const SIGN_IN_FORMAT_ERROR = 'The sign-in request is not in the expected format';
export const SIGN_IN_SITE_ERROR = 'The sign-in request names another site';
export const SIGN_IN_NETWORK_ERROR = 'The sign-in request is for another network';
export const SIGN_IN_ACCOUNT_ERROR = 'The sign-in request is for another account';
export const SIGN_IN_EXPIRED_ERROR = 'The sign-in request has expired';
export const SIGN_IN_TOO_LONG_ERROR = 'The sign-in request lasts longer than 15 minutes';
export const SIGN_IN_ERRORS: readonly string[] = [
  SIGN_IN_FORMAT_ERROR,
  SIGN_IN_SITE_ERROR,
  SIGN_IN_NETWORK_ERROR,
  SIGN_IN_ACCOUNT_ERROR,
  SIGN_IN_EXPIRED_ERROR,
  SIGN_IN_TOO_LONG_ERROR,
];
