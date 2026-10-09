/** Mailer service (COLD). */
export interface Mail { to: string; subject: string; body: string }

// <region:body>
export function formatMail(mail: Mail): string {
  return `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.body}`;
}
export function isValidAddress(addr: string): boolean {
  return addr.includes('@');
}
// </region:body>
