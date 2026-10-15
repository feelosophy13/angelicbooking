/** How many text messages a body will be billed as: 160 characters in one, 153 per part when it spans several; 70/67 when it has characters outside the basic set (emoji, curly quotes). */
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

export function smsSegments(body: string): { length: number; segments: number; unicode: boolean } {
  const unicode = !GSM.test(body);
  const length = [...body].length;
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { length, unicode, segments: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi) };
}
