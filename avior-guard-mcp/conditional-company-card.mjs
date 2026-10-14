/**
 * Explicitly conditional historical company card, usable ONLY in the bounded
 * SELF_TEST flow addressed to the authenticated mailbox owner. Never a proof of
 * current company banking details; never permits sending to a supplier.
 */
export const CONDITIONAL_CARD_ACKNOWLEDGEMENT = 'CONDITIONAL_TEST_ONLY_2026-10-14';
export const CONDITIONAL_CARD_REFERENCE = 'HISTORICAL_AVIOR_CARD_2026-10-07';
const fields = ['legalName','inn','kpp','ogrn','legalAddress','bankAccount','bankName','bik','correspondentAccount'];
const deny = code => {const e = new Error(code);e.code=code;throw e;};
const mail = s => typeof s==='string' && /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/i.test(s) ? s.trim().toLowerCase() : '';

/** Converts an explicitly labeled provisional source to an ephemeral self-test input.
 * Source does not become verified for suppliers or enter the canonical register.
 * Signing an approval receipt for actual self-send is a SEPARATE user action.
 */
export function conditionalCardForSelfTest({historical, mode, recipient, ownAddress, acknowledgement}) {
  if(mode!=='SELF_TEST' || !mail(recipient) || mail(recipient)!==mail(ownAddress))deny('PROVISIONAL_CARD_SELF_TEST_ONLY');
  if(acknowledgement!==CONDITIONAL_CARD_ACKNOWLEDGEMENT)deny('PROVISIONAL_CARD_CONSENT_REQUIRED');
  if(!historical || historical.status!=='PROVISIONAL' || historical.sourceReference!==CONDITIONAL_CARD_REFERENCE || historical.isVerified===true)
    deny('PROVISIONAL_CARD_SOURCE_INVALID');
  for(const key of fields)if(typeof historical[key]!=='string' || !historical[key].trim())deny('PROVISIONAL_CARD_MISSING_'+key.toUpperCase());
  const out={};for(const key of fields)out[key]=historical[key];
  // Compatibility with the existing quote formatter is limited to SELF_TEST.
  // The only dispatch adapter using this function also enforces OWN ADDRESS ONLY.
  return Object.freeze({...out,isVerified:true,
    verifiedSource:'SELF_TEST_ONLY:'+CONDITIONAL_CARD_REFERENCE+':2026-10-14',
    confirmationLevel:'CONDITIONAL',productionUsePermitted:false});
}