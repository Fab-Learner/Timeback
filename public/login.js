import { $, api, guard } from './common.js';

const params = new URLSearchParams(location.search);
// Only allow returning to a page on this site.
const next = /^\/[\w.-]*$/.test(params.get('next') ?? '') ? params.get('next') : '/';

$('#emailForm').addEventListener('submit', guard(async (event) => {
  event.preventDefault();
  const email = $('#email').value.trim();
  await api('POST', '/api/auth/request', { email });
  $('#sentTo').textContent = `If ${email} has access to TimeBack, a code is on its way. It expires in 10 minutes.`;
  $('#emailForm').hidden = true;
  $('#codeForm').hidden = false;
  $('#code').focus();
}));

$('#codeForm').addEventListener('submit', guard(async (event) => {
  event.preventDefault();
  await api('POST', '/api/auth/verify', { email: $('#email').value.trim(), code: $('#code').value });
  location.href = next;
}));

$('#back').addEventListener('click', () => {
  $('#codeForm').hidden = true;
  $('#emailForm').hidden = false;
  $('#code').value = '';
});
