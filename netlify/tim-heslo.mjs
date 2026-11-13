// Spoločné heslo tímu pre interné stránky (prehľad schvaľovania, denník AI videí).
// Nastavuje sa v Netlify: Site configuration > Environment variables > TIM_HESLO.
import { createHash, timingSafeEqual } from 'node:crypto';

export const hesloNastavene = () => Boolean(process.env.TIM_HESLO);

export function hesloOk(zadane) {
  const spravne = process.env.TIM_HESLO || '';
  if (!spravne || !zadane) return false;
  const a = createHash('sha256').update(String(zadane)).digest();
  const b = createHash('sha256').update(spravne).digest();
  return timingSafeEqual(a, b);
}
