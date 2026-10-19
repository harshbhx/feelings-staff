/**
 * Owner password policy (PRD 4.1.7, 10.3): at least 10 characters and not a common password.
 * The bundled list is deliberately small: only entries of 10+ characters matter (shorter ones fail
 * the length rule), plus patterns that cover the long tail (one repeated character, keyboard or
 * digit runs, the salon's own name, the owner's email).
 */
const COMMON = new Set([
  '0000000000',
  '0123456789',
  '0987654321',
  '1029384756',
  '1111111111',
  '1122334455',
  '1123581321',
  '1212121212',
  '1234512345',
  '1234554321',
  '1234567890',
  '12345678910',
  '1234567890a',
  '123456789a',
  '123456789q',
  '123123123123',
  '123qweasdzxc',
  '147258369a',
  '1q2w3e4r5t',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  '2wsx3edc4rfv',
  '5555555555',
  '7777777777',
  '9876543210',
  '987654321a',
  'a123456789',
  'a1b2c3d4e5',
  'aaaaaaaaaa',
  'abc1234567',
  'abcd123456',
  'abcdefghij',
  'abcdefghijk',
  'asdfghjkl1',
  'asdfghjkl;',
  'asdfasdfasdf',
  'babygirl12',
  'basketball',
  'boobooboo1',
  'changeme123',
  'chocolate1',
  'football12',
  'football123',
  'foreverlove',
  'friendship',
  'happybirthday',
  'hellohello',
  'iloveyou12',
  'iloveyou123',
  'india12345',
  'india123456',
  'indian1234',
  'jaimataji1',
  'jaishreeram',
  'jaishriram',
  'krishna123',
  'letmein123',
  'loveyou123',
  'manchester',
  'mypassword',
  'mypassword1',
  'nopassword',
  'p@ssw0rd123',
  'passw0rd123',
  'password01',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'password@123',
  'pa55word123',
  'princess12',
  'q1w2e3r4t5',
  'qazwsxedc1',
  'qazwsxedcrfv',
  'qwer123456',
  'qwerty1234',
  'qwerty12345',
  'qwerty123456',
  'qwertyuiop',
  'qwertyuiop1',
  'samsung123',
  'starwars12',
  'sunshine12',
  'superman12',
  'trustno123',
  'welcome123',
  'welcome@123',
  'whatever12',
  'zaq12wsxcde',
  'zxcvbnm123',
  'zxcvbnmasd',
]);

const SALON_WORDS = ['feelings', 'feelingsbeautycare', 'beautycare', 'jamnagar'];

export type PasswordProblem = 'short' | 'common' | 'personal';

/** First problem with a proposed owner password, or null when it is acceptable. */
export function passwordProblem(password: string, email?: string | null): PasswordProblem | null {
  if (password.length < 10) return 'short';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'common';
  if (/^(.)\1+$/.test(lower)) return 'common';
  if ('01234567890123456789'.includes(lower) || '98765432109876543210'.includes(lower))
    return 'common';
  if ('qwertyuiopasdfghjklzxcvbnm'.includes(lower)) return 'common';
  const stripped = lower.replace(/[^a-z]/g, '');
  if (SALON_WORDS.some((w) => stripped === w || stripped === `${w}${w}`)) return 'common';
  const local = email
    ?.split('@')[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (local && local.length >= 4 && lower.replace(/[^a-z0-9]/g, '').includes(local))
    return 'personal';
  return null;
}
