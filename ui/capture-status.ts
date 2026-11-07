export function captureFailureMessage(error: string): string {
  if (/ERR_TUNNEL|redirect/i.test(error))
    return "The page redirected to another address and capture could not follow it. Retry; if it persists, open the page normally and use its final address.";
  if (/HTTP (401|403)|access controls/i.test(error))
    return "The website refused access (HTTP 401/403). SourceWatch does not bypass logins, paywalls or bot checks. Try a publicly accessible page.";
  if (/timeout|deadline|timed out/i.test(error))
    return "The page did not finish within the capture time limit. Check that it opens in your browser, then retry. Existing captures are safe.";
  if (/private|reserved|internal hostname/i.test(error))
    return "This address points to a private or internal network. SourceWatch only captures public websites.";
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(error))
    return "The website address could not be resolved. Check the spelling and your internet connection, then retry.";
  return "Capture did not complete. Check that the page opens normally, then retry. Your previously saved captures are unchanged.";
}
