import { DEFAULTS, numericInputKeys, calculate, minimumMarkup } from './finance.mjs';
import { recommend } from './recommend.mjs';
import { ALT_DEFAULTS, selectFundingProfile } from './profiles.mjs';
import { mountMeetingLayout } from './mobile-layout.mjs';
import { buildOffers } from './offers.mjs';
import { TOCHKA_PROFILE, LINE_PROFILE, tochkaAlternative, BILLING_PAIRS, BILLING_ENUMS } from './bank-profile.mjs';
import { billingControls } from './bank-controls.mjs';

const $ = id => document.getElementById(id);
const form = $('calculator');
const STORAGE = 'wagon-economics-v1';
const numbers = new Set([...numericInputKeys, ...Object.keys(ALT_DEFAULTS).filter(key => typeof ALT_DEFAULTS[key] === 'number'), 'targetProfit']);
const enums = {
  ...BILLING_ENUMS,
  ...Object.fromEntries(BILLING_PAIRS.filter(([primary]) => BILLING_ENUMS[primary]).map(([primary, alternative]) => [alternative, BILLING_ENUMS[primary]])),
  fundingKind: ['none', 'credit', 'line'], delayAnchor: ['payment', 'acceptance'],
  factorRateBase: ['invoice', 'advance'], clientRisk: ['reliable', 'late', 'new'],
  primaryFundingKind: ['credit', 'line'],
};
const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const inputDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 20 });
const money = n => n === null ? 'Не рассчитано' : currency.format(Math.abs(n) < 0.005 ? 0 : n);
const signed = n => `${n > 0.005 ? '+' : ''}${money(n)}`;
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const initialState = () => ({ ...DEFAULTS, ...ALT_DEFAULTS, ...LINE_PROFILE, ...tochkaAlternative(), clientRisk: 'reliable', insuranceConfirmed: false, targetProfit: 2000, profileVersion: 4 });
let state = initialState();
let meeting = null;
let lastQuotePrice = null;
let meetingAction = '';
let result = null;
let priceRows = [];
let storageAvailable = true;
let timer;

function numberField(name, label, unit, help = '', full = false) {
  return `<div class="field${full ? ' full' : ''}"><label for="${name}">${label}</label><div class="input-unit"><input id="${name}" name="${name}" type="text" inputmode="${/Day|Days|Delay|Volume/.test(name) ? 'numeric' : 'decimal'}" autocomplete="off" aria-describedby="${name}-help"><span>${unit}</span></div><small id="${name}-help">${help}</small></div>`;
}
function fieldGrid(...fields) { return `<div class="field-grid two">${fields.join('')}</div>`; }
function checkbox(name, label, help = '') { return `<label class="check-row" for="${name}"><input type="checkbox" name="${name}" id="${name}"><span>${label}${help ? `<small>${help}</small>` : ''}</span></label>`; }
function selectField(name, label, options) { return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></div>`; }
function instrument(number, name, title, intro, content) {
  return `<article class="instrument" id="card-${name}"><div class="instrument-head"><span class="instrument-number">${number}</span><div class="instrument-title"><h3 id="title-${name}">${title}</h3><p>${intro}</p></div><label class="toggle" for="${name}"><input type="checkbox" ${name === 'fundingEnabled' ? 'data-funding-toggle' : `name="${name}"`} id="${name}" aria-label="Подключить: ${title}"><span class="toggle-track"></span></label></div><details class="settings-details"><summary>Условия и все платежи</summary><div class="details-content">${content}</div></details></article>`;
}

$('instrument-controls').innerHTML = [
  instrument('01', 'fundingEnabled', 'Заёмные деньги до оплаты клиента', 'Кредитная линия или овердрафт закрывают нехватку денег. Неплатёж клиента остаётся вашим риском.',
    selectField('fundingKind', 'Какой источник денег используем', [['line', 'ВКЛ — ставка за используемый остаток'], ['credit', 'Точка — оборотный кредит на месяцы'], ['none', 'Без кредита: свои деньги / аванс']])
    + checkbox('fundingTermsKnown', 'Условия выбранного продукта введены', 'В исходном примере ставки расчётные. При переключении на неизвестный продукт введите его тариф; лимит другого продукта сюда не переносится.')
    + fieldGrid(numberField('fundingRate', 'Процент на непогашенный долг', '% год.', '23,5% — пример. 0% — если договор предусматривает только фиксированную плату.'), numberField('fundingLimit', 'Подтверждённый свободный лимит', '₽', 'Именно свободный остаток под эту заявку. 0 — одобренных денег пока нет.'))
    + '<p class="product-note">Овердрафт обычно требует регулярных поступлений на счёт и ограничения непрерывного долга. Введите свой срок клиента и проверьте, укладывается ли он в срок договора.</p>'
    + fieldGrid(numberField('fundingFeePercent', 'Разовая комиссия от закупки', '%', 'База — вся закупочная цена, без НДС самой комиссии.'), numberField('fundingFeeFixed', 'Разовая плата сверх процента', '₽', 'Без НДС. Оплачивается в день 0.'))
    + fieldGrid(numberField('fundingMonthly', 'Плата за использование в месяц', '₽', 'Без НДС. Полная абонентская плата, не погашение тела кредита.'), numberField('fundingMonthlyVolume', 'Вагонов на этом продукте в месяц', 'шт.', '0 — используем общий объём работы. Если кредит нужен на 10 вагонов, введите 10.'))
    + numberField('fundingFeeVatPercent', 'НДС разовых и месячных комиссий', '%', 'Проверьте договор. Для обычного кредитного процента НДС здесь не начисляем.')
    + '<details class="settings-details"><summary>Тариф второго продукта для сравнения</summary><div class="details-content"><p>Если выбран ВКЛ, здесь хранятся отдельные условия Точки. Если выбрана Точка, здесь условия ВКЛ. Ставки, комиссии и одобренные лимиты не переносятся между ними.</p>'
    + checkbox('altKnown', 'Сравнивать второй источник по введённым условиям', 'Без этой отметки не выдумываем ставку альтернативного продукта.')
    + fieldGrid(numberField('altRate', 'Годовая ставка второго продукта', '% год.', '0% допустимо, если вместо процентов есть месячная плата.'), numberField('altLimit', 'Его подтверждённый свободный лимит', '₽', 'Лимит первого продукта не переносим на второй.'))
    + fieldGrid(numberField('altFeePercent', 'Разовая комиссия от закупки', '%', 'Без НДС комиссии.'), numberField('altFeeFixed', 'Разовая фиксированная плата', '₽', 'Без НДС.'))
    + fieldGrid(numberField('altMonthly', 'Его плата за месяц', '₽', 'Без НДС. Полный месячный платёж за использование.'), numberField('altMonthlyVolume', 'Его число вагонов в месяц', 'шт.', '0 — общий объём.'))
    + numberField('altFeeVatPercent', 'НДС его комиссий', '%', 'По договору и документам.') + '</div></details>'),
  instrument('02', 'factorEnabled', 'Факторинг после выполнения', 'Фактор раньше клиента выдаёт часть его долга. До приёмки поставщика нужно оплатить другим источником.',
    fieldGrid(numberField('factorRate', 'Плата за срок финансирования', '% год.', '17% — пример. Введите договорную ставку.'), numberField('factorAdvancePercent', 'Первая выплата от долга клиента', '%', '95% — пример. 100% означает всю неоплаченную сумму; комиссия может удерживаться.'))
    + selectField('factorRateBase', 'На какую сумму начисляют годовой процент', [['invoice', 'На весь неоплаченный долг клиента'], ['advance', 'На сумму первого финансирования']])
    + numberField('factorDelay', 'От приёмки до реальных денег фактора', 'дней', 'Учитывайте проверку документов и время выплаты, а не только дату подачи.')
    + fieldGrid(numberField('factorFeePercent', 'Разовая комиссия от долга клиента', '%', 'Сверх годового процента, без НДС комиссии.'), numberField('factorFixed', 'Ещё разовая плата за заявку', '₽', 'Без НДС. Например, за обработку документов.'))
    + fieldGrid(numberField('factorMonthly', 'Плата за продукт в месяц', '₽', 'Без НДС. Платится и при отсутствии выплаты, если так предусмотрено договором.'), numberField('factorMonthlyVolume', 'Вагонов с факторингом в месяц', 'шт.', '0 — общий объём; другой объём — распределяем только на эти заявки.'))
    + numberField('factorVatPercent', 'НДС на услуги фактора', '%', 'Уточните каждую услугу в договоре. Модель применяет одну ставку ко всем выбранным платам фактора.')
    + checkbox('factorUpfront', 'Удержать комиссию при первой выплате', 'Если выключено — комиссия оплачивается в день денег клиента. Удержание сразу может увеличить остаток кредита.')
    + checkbox('factorRecourse', 'Факторинг с регрессом', 'При неоплате клиентом фактор может потребовать возврат от вас. Выключайте только для согласованного безрегрессного договора.')
    + checkbox('factorConfirmed', 'Лимит на клиента и выплату подтверждены', 'Подтверждены сумма, документы, сроки, условия регресса и действующий лимит. Галочка не заменяет договор.')),
  instrument('03', 'insuranceEnabled', 'Страхование долга клиента', 'Защита от предусмотренного полисом неплатежа. Деньги для оплаты поставщика страховка не выдаёт.',
    numberField('insurancePercent', 'Премия один раз от всего счёта', '%', '0,5% — пример, не годовая ставка. В модели платим премию в день 0, без НДС.')
    + checkbox('insuranceConfirmed', 'Полис одобрен на этого клиента и сумму', 'Для рекомендации учитываем защиту только при подтверждении. Проверьте лимит, долю покрытия, исключения и срок выплаты.')
    + '<p class="product-note">Страхование может оставить на вас часть убытка и не покрывать спор о качестве. При безрегрессном факторинге проверьте, не платите ли дважды за одно покрытие.</p>'),
  instrument('04', 'guaranteeEnabled', 'Банковская гарантия', 'Здесь считаем стоимость вашей гарантии. Она подтверждает обязательство, но сама не создаёт оборотные деньги.',
    fieldGrid(numberField('guaranteeRate', 'Годовая плата от всего счёта', '% год.', 'Введите свою ставку. Срок гарантии — отдельный от отсрочки.'), numberField('guaranteeDays', 'Срок действия гарантии', 'дней', 'Полная длительность из договора.'))
    + fieldGrid(numberField('guaranteeFeePercent', 'Разовая плата от счёта', '%', 'Без НДС, дополнительно к годовой.'), numberField('guaranteeFixed', 'Разовая фиксированная плата', '₽', 'Без НДС. Платим в день 0.'))
    + fieldGrid(numberField('guaranteeVatPercent', 'НДС комиссии', '%', 'По документам банка.'), numberField('guaranteeCollateral', 'Деньги под обеспечение', '₽', 'Блокируем в день 0. Упрощённо возвращаем в день оплаты клиента.'))
    + '<p class="product-note">Гарантия, которую вы выдаёте поставщику, и гарантия оплаты, полученная от клиента, защищают разных людей. Полученную от клиента гарантию проверяют по банку, условиям требования и сроку. Обеспечение может быть запрещено финансировать кредитом, а возврат может быть позже оплаты клиента.</p>'),
  instrument('05', 'lcEnabled', 'Аккредитив', 'Банк перечисляет деньги при предъявлении согласованных документов. Покрытый аккредитив требует денег или отдельного кредита.',
    fieldGrid(numberField('lcFeePercent', 'Комиссия один раз от счёта', '%', 'Полная процентная комиссия за ваш срок, не годовых.'), numberField('lcFixed', 'Фиксированная комиссия', '₽', 'Без НДС. Платим в день 0.'))
    + fieldGrid(numberField('lcVatPercent', 'НДС комиссии', '%', 'Проверьте документы банка.'), numberField('lcCollateral', 'Сумма покрытия / блокировки', '₽', 'Блокируем в день 0. Поставщику платим из покрытия, недостающую часть — отдельно.'))
    + '<p class="product-note">Покрытие — заранее зарезервированные деньги для оплаты поставщика. Одну сумму не списываем дважды. Неиспользованный остаток упрощённо возвращаем после оплат клиента и поставщика; реальную дату проверьте в договоре. Аккредитив проверяет документы, а не качество товара.</p>'),
  instrument('06', 'accountEnabled', 'Ежемесячный тариф банка', 'Отдельная плата за расчётный счёт или банковский пакет. Подписка продукта и тариф счёта могут взиматься одновременно.',
    fieldGrid(numberField('accountMonthly', 'Полная плата за месяц', '₽', 'Без НДС. Не включайте повторно то, что уже есть в бюджете компании.'), numberField('accountMonthlyVolume', 'Вагонов на этом тарифе в месяц', 'шт.', '0 — общий объём работы.'))
    + numberField('accountVatPercent', 'НДС этой платы', '%', 'По договору и документам банка.')
    + '<p class="product-note">Не путайте: платёж по графику кредита включает возврат долга; расходом являются проценты и комиссии. В это поле вводится именно плата банку, а не весь платёж по кредиту.</p>'),
].join('');

const billingHelpers = { numberField, fieldGrid, checkbox, selectField };
const primaryDetails = $('card-fundingEnabled').querySelector(':scope > details > .details-content');
const primaryBilling = document.createElement('div');
primaryBilling.innerHTML = '<div class="bank-profile-note"><b>Два отдельных источника денег</b><p><b>ВКЛ</b> — возобновляемая кредитная линия: оплачиваем используемый остаток и дни. 23,5% годовых — пример для сравнения, замените банковской ставкой и проверьте даты списания процентов.</p><p><b>Точка</b> — описанные вами 2,49% в месяц от первоначальной суммы, первая комиссия при выдаче. Срок 3–12 месяцев; диапазон предложения 50 000–27 510 000 ₽.</p><button type="button" id="apply-line">Пример ВКЛ</button> <button type="button" id="apply-tochka">Условия Точки</button><small>Это независимые тарифы и лимиты. График тела Точки и отмена будущих комиссий при досрочном не подтверждены.</small></div>' + billingControls(billingHelpers);
primaryDetails.prepend(primaryBilling);
const alternateBilling = document.createElement('div');
alternateBilling.innerHTML = billingControls(billingHelpers, true);
$('altKnown').closest('.check-row').after(alternateBilling);
for (const [name, text] of [['fundingFeePercent', 'Дополнительная комиссия один раз, % закупки'], ['fundingFeeFixed', 'Дополнительная комиссия один раз, ₽'], ['factorAdvancePercent', 'Какую часть счёта фактор выдаст сразу'], ['factorFeePercent', 'Дополнительная плата фактора, % долга'], ['factorFixed', 'Дополнительная плата фактора, ₽']]) $(name).labels[0].textContent = text;
const creditSummary = document.createElement('div');
creditSummary.id = 'credit-summary'; creditSummary.className = 'credit-summary';
const copyMeeting = document.createElement('button');
copyMeeting.type = 'button'; copyMeeting.id = 'copy-meeting'; copyMeeting.className = 'copy-meeting'; copyMeeting.textContent = 'Скопировать цену и условия';

const recommendationPanel = document.createElement('section');
recommendationPanel.className = 'panel recommendation-panel';
recommendationPanel.setAttribute('aria-labelledby', 'recommendation-title');
recommendationPanel.innerHTML = '<p class="eyebrow">КАКУЮ СХЕМУ ВЫБРАТЬ</p><h2 id="recommendation-title">Лучший вариант при ваших условиях</h2><div id="recommendation"></div>';
$('result').insertBefore(recommendationPanel, $('result').querySelector('.minima-panel'));
mountMeetingLayout(document);
$('quote-explanation').after(creditSummary);
$('apply-quote').after(copyMeeting);

function alternativeFunding() {
  if (!state.altKnown) return null;
  return { ...Object.fromEntries(BILLING_PAIRS.map(([primary, alternative]) => [primary, state[alternative]])), fundingKind: state.primaryFundingKind === 'line' ? 'credit' : 'line', fundingRate: state.altRate, fundingLimit: state.altLimit,
    fundingFeePercent: state.altFeePercent, fundingFeeFixed: state.altFeeFixed, fundingFeeVatPercent: state.altFeeVatPercent,
    fundingMonthly: state.altMonthly, fundingMonthlyVolume: state.altMonthlyVolume };
}
function currentAdvice() { return recommend(state, state.clientRisk, state.insuranceConfirmed, alternativeFunding()); }
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return;
    if (raw.length > 30000) throw new Error('Размер сохранённых параметров превышен.');
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Некорректные параметры.');
    const clean = { ...state };
    for (const [key, defaultValue] of Object.entries(state)) {
      if (!Object.hasOwn(saved, key)) continue;
      if (typeof saved[key] !== typeof defaultValue) continue;
      if (enums[key] && !enums[key].includes(saved[key])) continue;
      clean[key] = saved[key];
    }
    let restored = clean;
    if (saved.profileVersion !== 4) {
      const knownTochka = saved.primaryFundingKind === 'credit' && saved.fundingInterestMode === 'monthly_full'
        ? Object.fromEntries(Object.keys(DEFAULTS).filter(key => key.startsWith('funding')).map(key => [key, clean[key]])) : TOCHKA_PROFILE;
      const bankDefaults = initialState();
      const onlyBankKeys = Object.fromEntries(Object.entries(bankDefaults).filter(([key]) => key.startsWith('funding') || key.startsWith('alt') || key === 'primaryFundingKind'));
      restored = { ...clean, ...onlyBankKeys, ...tochkaAlternative(knownTochka), profileVersion: 4 };
    }
    calculate(restored);
    state = restored;
  } catch {
    $('action-status').textContent = 'Сохранённый расчёт недоступен. Открыт исходный пример.';
  }
}
function fillForm() {
  for (const [key, value] of Object.entries(state)) {
    const element = form.elements.namedItem(key);
    if (!element) continue;
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else element.value = typeof value === 'number' ? inputDecimal.format(value) : value;
  }
  $('fundingEnabled').checked = state.fundingKind !== 'none';
  syncCards();
}
function syncCards() {
  for (const name of ['fundingEnabled', 'factorEnabled', 'insuranceEnabled', 'guaranteeEnabled', 'lcEnabled', 'accountEnabled']) {
    $(`card-${name}`).classList.toggle('is-active', $(name).checked);
  }
  for (const button of document.querySelectorAll('[data-days]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.days) === state.clientDays));
  }
}
function readForm() {
  const next = { ...state };
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  for (const element of form.elements) {
    const key = element.name;
    if (!key || !Object.hasOwn(state, key)) continue;
    if (element.type === 'checkbox') next[key] = element.checked;
    else if (numbers.has(key)) {
      const cleaned = element.value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
      if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned) || !Number.isFinite(Number(cleaned))) {
        element.setAttribute('aria-invalid', 'true');
        throw new RangeError(`Заполните поле «${element.labels?.[0]?.textContent.trim() || key}» числом. Пример: 100000 или 100 000.`);
      }
      next[key] = Number(cleaned);
    } else if (enums[key]) {
      if (!enums[key].includes(element.value)) throw new RangeError('Выберите один из предложенных вариантов.');
      next[key] = element.value;
    }
  }
  if (!$('fundingEnabled').checked) next.fundingKind = 'none';
  return next;
}
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
  catch {
    storageAvailable = false;
    $('action-status').textContent = 'Браузер не разрешает сохранение. Расчёт работает, но параметры после закрытия страницы могут потеряться.';
  }
}
function renderError(error) {
  $('manual-copy')?.remove();
  result = null;
  meeting = null;
  $('form-error').hidden = false;
  $('form-error').textContent = `${error.message} Результаты временно скрыты, чтобы не показывать старую прибыль.`;
  $('profit').textContent = 'Проверьте ввод';
  $('profit-badge').textContent = 'Нет расчёта';
  $('mobile-profit').textContent = 'Ошибка ввода';
  $('invoice-price').textContent = '—';
  $('monthly-profit').textContent = '—';
  $('breakdown').replaceChildren();
  $('minimum-cards').replaceChildren();
  $('recommendation').replaceChildren();
  $('liquidity-verdict').textContent = 'После исправления полей пересчитаем деньги.';
  $('liquidity-verdict').classList.remove('ok');
  $('liquidity-dot').classList.remove('ok');
  $('payment-explanation').textContent = 'Исправьте ввод, чтобы построить календарь денег.';
  $('overhead-preview').textContent = '—';
  for (const id of ['initial-need', 'peak-need', 'cash-gap']) $(id).textContent = '—';
  for (const id of ['timeline', 'tool-impact', 'scenario-table', 'stress-cards', 'prices-table', 'warnings']) $(id).replaceChildren();
  $('profit-line').replaceChildren();
  $('meeting-error').hidden = false;
  $('meeting-error').textContent = error.message;
  $('quote-price').textContent = 'Проверьте ввод';
  for (const id of ['quote-markup', 'quote-current-profit', 'quote-explanation', 'meeting-best', 'offer-cards', 'launch-explainer', 'meeting-status', 'credit-summary']) $(id).replaceChildren();
  $('apply-quote').disabled = true;
  $('copy-meeting').disabled = true;
  $('copy-result').disabled = true;
  $('print-result').disabled = true;
  $('download-prices').disabled = true;
}
function render() {
  $('manual-copy')?.remove();
  try {
    const next = readForm();
    if (next.fundingKind !== 'none' && next.fundingKind !== next.primaryFundingKind) throw new RangeError('Тип продукта не совпадает с его тарифом. Переключите продукт после исправления остальных полей.');
    if (next.fundingKind !== 'none' && !next.fundingTermsKnown) throw new RangeError('Условия выбранного банковского продукта ещё не введены. Заполните его тариф и отметьте «Условия выбранного продукта введены». Лимит другого продукта не переносится.');
    result = calculate(next);
    if (next.altKnown) calculate({ ...next, ...Object.fromEntries(BILLING_PAIRS.map(([primary, alternative]) => [primary, next[alternative]])), fundingKind: next.primaryFundingKind === 'line' ? 'credit' : 'line', fundingRate: next.altRate, fundingLimit: next.altLimit, fundingFeePercent: next.altFeePercent, fundingFeeFixed: next.altFeeFixed, fundingFeeVatPercent: next.altFeeVatPercent, fundingMonthly: next.altMonthly, fundingMonthlyVolume: next.altMonthlyVolume });
    state = next;
    $('form-error').hidden = true;
    $('copy-result').disabled = false;
    $('print-result').disabled = false;
    $('download-prices').disabled = false;
    $('copy-meeting').disabled = false;
    syncCards();
    renderResults();
    renderRecommendations();
    renderTimeline();
    renderImpact();
    renderRisk();
    renderMeeting();
    if ($('price-details').open) renderPrices();
    else priceRows = [];
    persist();
  } catch (error) { renderError(error); }
}
function humanScheme(params) {
  const funding = params.fundingKind === 'none' ? 'Без кредита' : params.fundingKind === 'line' ? 'ВКЛ' : params.fundingKind === 'overdraft' ? 'Овердрафт' : 'Точка';
  return `${funding}${params.factorEnabled ? ' → факторинг' : ''}${params.insuranceEnabled ? ' + страхование' : ''}`;
}
function offerAvailability(offer) {
  if (!offer.quote) return 'Целевая прибыль не достигается при добавке до 1 млн ₽.';
  if (!offer.riskSuitable) return 'Для этого клиента защита от неплатежа не подтверждена.';
  const r = offer.quoteResult;
  if (offer.params.fundingLoanMax > 0 && r.peakBankLoan > offer.params.fundingLoanMax) return 'Нужная выдача больше максимальной суммы этого продукта.';
  if (r.creditPricing.repaymentReserveGap > 0) return `До клиента не хватает ${money(r.creditPricing.repaymentReserveGap)} на плановые платежи. Нужен резерв или более ранние поступления.`;
  if (r.creditPricing.tradeFundingGap > 0) return `После платежей банку на закупку не хватает ${money(r.creditPricing.tradeFundingGap)}.`;
  if (offer.params.fundingCloseMode === 'scheduled' && !offer.params.fundingScheduleConfirmed && r.creditPricing.amount > 0) return 'Цена посчитана по полной комиссии. График возврата долга пока примерный — сверьте его с офертой.';
  if (offer.params.fundingCloseMode === 'on_client' && !offer.params.fundingEarlyConfirmed && r.creditPricing.amount > 0) return 'Сценарий досрочного возврата: отмена будущих комиссий банком не подтверждена.';
  if (r.closingDebt > 0) return 'После оплаты клиента остаётся долг: нужны другие условия.';
  if (r.uncoveredGap > 0) return offer.params.fundingLimit === 0 || offer.params.fundingKind === 'none'
    ? 'Цена рассчитана. Источник денег для запуска ещё нужно подтвердить.'
    : `На запуск не хватает ${money(r.uncoveredGap)} подтверждённых денег.`;
  if (r.factorUsed && !offer.params.factorConfirmed) return 'Для запуска нужно подтверждение выплаты фактора.';
  return 'На одну заявку источников по введённым условиям хватает.';
}
function shortAvailability(offer) {
  if (!offer.quote) return 'Цель не достигается';
  if (!offer.riskSuitable) return 'Нет подтверждённой защиты';
  const r = offer.quoteResult;
  if (r.creditPricing.repaymentReserveGap > 0) return `Нужен резерв ${money(r.creditPricing.repaymentReserveGap)}`;
  if (r.creditPricing.tradeFundingGap > 0) return 'Не хватает денег на закупку';
  if (offer.params.fundingCloseMode === 'scheduled' && !offer.params.fundingScheduleConfirmed && r.creditPricing.amount > 0) return 'График пока примерный';
  if (r.uncoveredGap > 0) return 'Лимит ещё не подтверждён';
  if (r.factorUsed && !offer.params.factorConfirmed) return 'Нужно одобрение фактора';
  return offer.executionReadyQuote ? 'Источники отмечены' : 'Нужно уточнить условия';
}
function renderMeeting() {
  meeting = buildOffers(state, state.targetProfit, { risk: state.clientRisk, insuranceConfirmed: state.insuranceConfirmed, alternativeFunding: alternativeFunding() });
  $('meeting-error').hidden = true;
  const selected = meeting.selected;
  const q = selected.quote;
  const r = selected.quoteResult;
  const target = money(state.targetProfit);
  $('quick-overhead').innerHTML = `Учтены расходы компании ${money(result.overheadPerWagon)} на вагон при ${whole.format(state.volume)} вагонах в месяц. <a href="#advanced-settings" data-open-settings>Изменить</a>`;
  $('quote-title').textContent = `Цена для прибыли ${target}`;
  $('quote-price').textContent = q ? money(q.price) : 'Цель не достигается';
  $('quote-markup').textContent = q ? `К закупке добавить ${money(q.markup)} с НДС.` : 'При добавке до 1 млн ₽ выбранные условия не дают этой прибыли.';
  $('quote-current-profit').innerHTML = `Если оставить вашу цену <b>${money(result.invoiceGross)}</b>, останется <b>${money(result.profit)}</b> после банка и расходов, до налога на прибыль.`;
  $('quote-explanation').textContent = selected.factorUnusedReason || (r && r.creditPricing.amount === 0 && r.peakFundingNeed === 0
    ? 'Разрыв закрывают указанные свои деньги, аванс или отсрочка поставщика. Новая выдача кредита для этой заявки не требуется.'
    : state.fundingKind !== 'none' && r?.creditPricing.amount > 0 && state.fundingCloseMode === 'scheduled' && state.fundingMonthlyBase === 'initial' && state.fundingInterestMode === 'monthly_full'
    ? `Комиссию считаем за весь срок ${state.fundingTermMonths} мес. от первоначальной выдачи. Быстрая оплата клиента и фактор не уменьшают эту комиссию. Фактор может помочь вовремя внести платежи.`
    : state.factorEnabled && r?.factorUsed
    ? `Сначала ${state.fundingKind === 'none' ? 'нужны свои деньги, аванс или отсрочка поставщика' : 'закупку оплачивают заёмные деньги'}. Фактор перечисляет деньги на ${r.factorDay}-й день и сокращает долг до оплаты клиента.`
    : state.fundingKind === 'none' ? 'Банк не финансирует старт. Нужны свои деньги, аванс клиента или отсрочка поставщика.' : 'Заёмными деньгами платим поставщику. Когда клиент заплатит, погашаем долг. Проценты и платы включены в цену выше.');
  $('apply-quote').disabled = !q;
  for (const el of document.querySelectorAll('[data-goal]')) el.checked = Number(el.dataset.goal) === state.targetProfit;
  for (const el of document.querySelectorAll('[data-quick-tool]')) {
    el.setAttribute('aria-pressed', String($(el.dataset.quickTool).checked));
    if (el.dataset.quickTool === 'fundingEnabled') el.textContent = state.primaryFundingKind === 'line' ? 'ВКЛ' : 'Точка';
  }
  syncBillingFields();
  renderCreditSummary(r);
  $('quick-date-note').innerHTML = state.delayAnchor === 'acceptance'
    ? `До приёмки ${state.acceptanceDay} дней + отсрочка ${state.clientDays}${state.lateDays ? ` + задержка ${state.lateDays}` : ''} = деньги клиента через <b>${result.paymentDay} дней</b>. <a href="#advanced-settings" data-open-settings>Изменить приёмку</a>`
    : `Клиент платит через <b>${result.paymentDay} дней</b>${state.lateDays ? `, включая задержку ${state.lateDays} дней` : ''}. Приёмка для фактора — через ${state.acceptanceDay} дней. <a href="#advanced-settings" data-open-settings>Изменить</a>`;
  $('offers-title').textContent = `Схемы при оплате через ${result.paymentDay} дней`;
  $('offers-intro').textContent = `Сравниваем цену для прибыли ${target} и заработок при вашей нынешней цене ${money(result.invoiceGross)}. Нажмите «Выбрать» — инструменты и цена выше пересчитаются.`;
  const best = meeting.bestAvailable || meeting.bestCalculated;
  $('meeting-best').classList.toggle('caution', !meeting.bestAvailable);
  if (best) {
    const credit = meeting.offers.find(o => o.id === (state.insuranceEnabled ? 'credit-insurance' : 'credit'));
    const saving = credit?.quote ? credit.quote.price - best.quote.price : 0;
    $('meeting-best').innerHTML = `<strong>${meeting.bestAvailable ? 'Рекомендуем по введённым условиям' : 'Выгоднее по расчёту'}: ${esc(humanScheme(best.params))}.</strong>${saving > 0 ? ` Цена ниже на ${money(saving)} по сравнению с ${state.primaryFundingKind === 'line' ? 'ВКЛ' : 'Точкой'} без фактора.` : ''}<small>${meeting.bestAvailable ? 'Выбрана самая низкая цена для нужной прибыли среди схем с отмеченными источниками денег и подходящей защитой клиента.' : 'Это цена для переговоров. Перед запуском подтвердите свободный лимит и условия выплаты; одобрение в расчёте не отмечено.'}</small>`;
  } else {
    $('meeting-best').textContent = meeting.noProtection ? 'Для этого клиента пока не рекомендуем необеспеченную отсрочку. Нужен аванс или подтверждённая защита от неплатежа.' : 'Для рекомендации введите условия доступного источника денег. Своих средств по расчёту не хватает.';
  }
  $('offer-cards').innerHTML = meeting.compactOffers.map(offer => {
    const active = offer.params.fundingKind === state.fundingKind && offer.params.factorEnabled === state.factorEnabled && offer.params.insuranceEnabled === state.insuranceEnabled;
    const winner = offer.id === best?.id;
    const flatScheduled = offer.params.fundingCloseMode === 'scheduled' && offer.params.fundingMonthlyBase === 'initial' && offer.params.fundingInterestMode === 'monthly_full';
    const reason = offer.factorUnusedReason || (offer.factorUseful && flatScheduled && offer.params.fundingKind !== 'none'
      ? `Комиссия кредита остаётся прежней. Фактор даст деньги на ${offer.quoteResult.factorDay}-й день и может покрыть платёж банку до клиента. Его услуга — дополнительный расход.`
      : offer.factorUseful ? `${offer.params.fundingKind === 'none' ? 'До первой выплаты нужны свои деньги, аванс или отсрочка поставщика' : 'Сначала закупку оплачиваем заёмными деньгами'}. На ${offer.quoteResult.factorDay}-й день фактор сократит долг; непокрытый остаток финансируем до клиента.`
      : offer.params.fundingKind === 'none' ? 'Работает за счёт своих денег, аванса или согласованной отсрочки поставщика.'
      : flatScheduled ? `Кредит на ${offer.params.fundingTermMonths} мес.: комиссия за месяц от первоначальной суммы, даже когда клиент платит раньше. Досрочную экономию не обещаем.` : `Цена учитывает выбранный порядок начисления и погашения. Срок оплаты клиента — ${result.paymentDay} дней.`);
    return `<article class="offer-card${winner ? ' is-best' : ''}${active ? ' is-selected' : ''}" data-offer-card="${offer.id}"><div class="offer-card-heading"><h3>${esc(humanScheme(offer.params))}</h3>${winner ? `<span class="offer-badge">${meeting.bestAvailable ? 'Рекомендуем' : 'Выгоднее'}</span>` : ''}</div><p class="offer-price-label">Цена для прибыли ${target}</p><strong class="offer-price">${offer.quote ? money(offer.quote.price) : 'Не достигается'}</strong><p class="offer-markup">${offer.quote ? `Добавить ${money(offer.quote.markup)}` : 'Проверьте тариф'}</p><div class="offer-metrics"><div><span>Прибыль при вашей цене</span><b class="${offer.currentResult.profit < 0 ? 'negative' : 'positive'}">${money(offer.currentResult.profit)}</b></div><div><span>Банк и защита</span><b>${money(offer.bankCostCurrent)}</b></div></div><p class="offer-availability${offer.executionReadyQuote && offer.riskSuitable ? ' ready' : ''}">${esc(shortAvailability(offer))}</p><details class="offer-info"><summary>Как работает</summary><p class="offer-reason">${esc(reason)}</p><p class="offer-reason">${esc(offerAvailability(offer))}</p></details><button type="button" data-select-offer="${offer.id}"${active ? ' disabled' : ''}>${active ? 'Выбрана' : 'Выбрать'}</button></article>`;
  }).join('');
  $('launch-explainer').innerHTML = `<p><b>${money(state.purchase)} — это ваша закупка.</b> Поставщику платим ${state.supplierDay ? `через ${state.supplierDay} дней` : 'сразу'}, клиент платит ${state.advancePercent === 100 ? 'весь счёт авансом' : result.clientAdvance > 0 ? `часть авансом, остаток через ${result.paymentDay} дней` : `через ${result.paymentDay} дней`}. Это одна и та же закупка, а не дополнительная комиссия банка.</p><small>${selected.executionReadyQuote ? 'Для одной заявки источники денег отмечены. Для всего месячного потока нужен отдельный общий лимит.' : 'Без своих денег, аванса или подтверждённого финансирования старт невозможен. В «Условиях» укажите свободные деньги и одобренный лимит.'}</small>`;
  $('mobile-label').textContent = `Цена для прибыли ${target}`;
  $('mobile-profit').textContent = q ? money(q.price) : 'Проверьте условия';
  if (meetingAction) {
    const change = q && lastQuotePrice !== null ? q.price - lastQuotePrice : null;
    $('meeting-status').textContent = change === 0 ? `Цена для цели не изменилась. ${selected.factorUnusedReason || 'Стоимость инструментов при этих условиях одинаковая.'}`
      : change !== null ? `Цена для нужной прибыли ${change > 0 ? 'выросла' : 'снизилась'} на ${money(Math.abs(change))}.` : 'Схема пересчитана.';
  } else $('meeting-status').textContent = '';
  lastQuotePrice = q?.price ?? null;
  meetingAction = '';
}
function syncBillingFields() {
  for (const alternative of [false, true]) {
    const value = primary => state[alternative ? BILLING_PAIRS.find(pair => pair[0] === primary)[1] : primary];
    const container = $(alternative ? 'alternative-billing' : 'primary-billing');
    container.querySelector('[data-monthly-fields]').hidden = value('fundingInterestMode') === 'annual_daily';
    container.querySelector('[data-scheduled-fields]').hidden = value('fundingCloseMode') !== 'scheduled';
    container.querySelector('[data-early-fields]').hidden = value('fundingCloseMode') !== 'on_client';
    const name = alternative ? 'altPrincipalMonthly' : 'fundingPrincipalMonthly';
    $(name).closest('.field').hidden = value('fundingPrincipalMode') === 'equal';
    $(alternative ? 'altRate' : 'fundingRate').closest('.field').hidden = value('fundingInterestMode') !== 'annual_daily';
    const upfrontName = alternative ? 'altMonthlyUpfront' : 'fundingMonthlyUpfront';
    $(upfrontName).closest('.check-row').hidden = value('fundingInterestMode') !== 'monthly_full';
  }
  const q = meeting?.selected.quoteResult || result;
  $('fundingFeePercent-help').textContent = `Дополнительный разовый сбор, не комиссия 2,49% в месяц. Например, 1% от закупки ${money(state.purchase)} = ${money(state.purchase / 100)}. Если банк берёт процент от выдачи, введите соответствующую сумму в рублях ниже.`;
  $('fundingFeeFixed-help').textContent = 'Отдельный сбор за выдачу в рублях. Например, банк просит 600 ₽ один раз — введите 600. Если такого сбора нет в договоре, оставьте 0.';
  $('fundingMonthly-help').textContent = 'Только дополнительная фиксированная плата за продукт или пакет сверх процентной комиссии. Не вводите сюда весь платёж по графику: в нём есть возврат долга.';
  const advance = q.unpaidInvoice * state.factorAdvancePercent / 100;
  $('factorAdvancePercent-help').textContent = `По счёту ${money(q.invoiceGross)} неоплаченный долг ${money(q.unpaidInvoice)}. При ${state.factorAdvancePercent}% фактор выдаст ${money(advance)} до удержания комиссии. Остаток ${money(q.unpaidInvoice - advance)} придёт после оплаты клиента.`;
}
function renderCreditSummary(r) {
  if (!r || state.fundingKind === 'none' || r.creditPricing.amount === 0) { $('credit-summary').replaceChildren(); return; }
  const c = r.creditPricing;
  const firstFee = (c.firstFee || 0) + r.fundingSetupGross;
  const moneyRow = firstFee > 0 ? `<div class="credit-money"><div><span>Берём у банка</span><b>${money(c.amount)}</b></div><div><span>Плата при выдаче</span><b>${money(firstFee)}</b></div><div><span>Заём минус плата</span><b>${money(c.amount - firstFee)}</b></div></div>` : `<p class="credit-brief">Для оплаты заявки используем <b>${money(c.amount)}</b> кредитного лимита. Это деньги на закупку и расходы, а не ещё одна комиссия.</p>`;
  const scheduled = state.fundingCloseMode === 'scheduled';
  $('credit-summary').innerHTML = `${moneyRow}<details><summary>Что платим банку и когда</summary><p>Проценты и процентные комиссии по этому кредитному сценарию: <b>${money(c.creditInterest)}</b>. Дополнительные сборы и подписки показаны отдельно в полном расчёте. Возврат взятых денег не вычитаем из прибыли второй раз. Здесь одна заявка оплачивает весь выбранный срок кредита; повторные обороты требуют отдельного расчёта портфеля.</p>${scheduled ? '<p>График ниже — расчётный пример с шагом 30 дней. Размер возврата долга и реальные даты сверяются с банковской офертой.</p>' : '<p>В примере ВКЛ проценты платим при возврате. Поступления от клиента и фактора уменьшают используемый долг. Таблица показывает только процентные платежи; возврат заёмных денег отражён в денежном цикле. Банковские даты списания процентов и условия досрочного возврата сверяются с договором.</p>'}<div class="table-scroll"><table><thead><tr><th>День</th><th>Проценты / комиссия</th>${scheduled ? '<th>Вернём долг</th><th>Всего</th>' : ''}</tr></thead><tbody>${c.repaymentSchedule.map(payment => `<tr><th scope="row">${payment.day}</th><td>${money(payment.interest)}</td>${scheduled ? `<td>${money(payment.principal)}</td><td>${money(payment.total)}</td>` : ''}</tr>`).join('')}</tbody></table></div><p>${c.repaymentReserveGap > 0 ? `До оплаты клиента на плановые платежи не хватает ${money(c.repaymentReserveGap)}. Деньги может дать резерв, аванс или фактор.` : 'Плановые платежи до клиента покрываются указанными источниками; это не подтверждает банковский график.'}</p></details>`;
}
function renderResults() {
  const r = result;
  $('invoice-price').textContent = money(r.invoiceGross);
  $('overhead-preview').textContent = `${money(r.overheadPerWagon)} / вагон`;
  $('payment-explanation').textContent = `По договору деньги клиента в день ${r.dueDay}. ${state.lateDays ? `С задержкой ${state.lateDays} дней — в день ${r.paymentDay}.` : 'В расчёте клиент платит вовремя.'} ${state.delayAnchor === 'acceptance' ? `Это ${state.acceptanceDay} дней до приёмки + ${state.clientDays} дней отсрочки.` : `Дни считаем от начала заявки; поставщику платим в день ${state.supplierDay}.`} Месяц в быстрой кнопке — 30 календарных дней.`;
  $('profit').textContent = money(r.profit);
  $('mobile-profit').textContent = money(r.profit);
  $('profit-badge').textContent = r.profit < 0 ? 'Убыток' : r.profit < 1000 ? 'Ниже 1 000 ₽' : 'Прибыль есть';
  document.querySelector('.result-panel').classList.toggle('is-negative', r.profit < 0);
  const rows = [
    ['Наценка в цене с НДС', state.markup], ['НДС из наценки', -r.vatOnMarkup],
    ['Остаётся до банка и расходов', r.markupNet, 'subtotal'],
    ['Проценты по заёмным деньгам', -r.breakdown.interest],
  ];
  const names = { factor: 'Факторинг', insurance: 'Страховая премия', guarantee: 'Комиссия гарантии', lc: 'Комиссия аккредитива', fundingSetup: 'Разовая комиссия заёмных денег', subscriptions: 'Месячные платы, доля на вагон' };
  for (const [key, label] of Object.entries(names)) if (r.breakdown[key] > 0) rows.push([label, -r.breakdown[key]]);
  rows.push(['Расходы компании, доля на вагон', -r.overheadPerWagon]);
  $('breakdown').innerHTML = rows.map(([label, value, cls]) => `<div${cls ? ` class="${cls}"` : ''}><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('');
  const costs = Object.values(r.breakdown).reduce((sum, value) => sum + value, 0);
  const denominator = Math.max(Math.abs(state.markup), costs, 1);
  $('profit-line').innerHTML = [[Math.max(0, r.profit), '#c8dc9f'], [costs, '#bc9c72'], [Math.max(0, r.vatOnMarkup), '#69857a']].filter(([size]) => size > 0).map(([size, color]) => `<span style="flex:${Math.min(size / denominator, 1)};background:${color}"></span>`).join('');
  $('monthly-profit').textContent = r.monthlyExpectedProfit === null ? 'Разные объёмы' : money(r.monthlyExpectedProfit);
  const avgFunding = calculate({ ...state, ownCash: 0 }).financingRublesDays * state.volume / 30;
  document.querySelector('.monthly-result small').textContent = r.monthlyExpectedProfit === null
    ? 'Месячный итог не считаем: платы распределены на разные числа вагонов. Нужна структура потока по схемам.'
    : `При ${whole.format(state.volume)} одинаковых заявках в месяц. Средняя сумма, связанная до оплат, около ${money(avgFunding)} при равномерном потоке. Нужен общий источник этой суммы; пиковые платежи могут быть выше. Свои деньги введены на одну заявку.`;
  $('initial-need').textContent = money(r.initialFundingNeed);
  $('peak-need').textContent = money(r.peakFundingNeed);
  $('cash-gap').textContent = money(r.uncoveredGap);
  const verdict = r.uncoveredGap > 0 ? `Не хватает подтверждённого источника на ${money(r.uncoveredGap)}. Даже при прибыли заявку пока нельзя обещать.`
    : r.creditPricing.repaymentReserveGap > 0 ? `До клиента на плановые платежи банку не хватает ${money(r.creditPricing.repaymentReserveGap)}. Нужен резерв или более ранние поступления.`
    : r.creditPricing.tradeFundingGap > 0 ? `После платежей банку на торговые платежи не хватает ${money(r.creditPricing.tradeFundingGap)}.`
    : state.fundingLoanMax > 0 && r.peakBankLoan > state.fundingLoanMax ? 'Нужная выдача больше максимальной суммы этого продукта.'
    : r.creditPricing.amount > 0 && state.fundingCloseMode === 'scheduled' && !state.fundingScheduleConfirmed ? 'График возврата долга пока расчётный. Для проверки запуска сверьте реальные суммы и даты в оферте.'
    : r.creditPricing.amount > 0 && state.fundingCloseMode === 'on_client' && !state.fundingEarlyConfirmed ? 'Банк ещё не подтвердил досрочный возврат и отмену будущих комиссий. Это условный сценарий.'
    : r.factorUsed && !state.factorConfirmed ? 'Кредитного лимита хватает, но выплата фактора не подтверждена. Сначала получите письменное одобрение.'
    : r.closingDebt > 0 ? `После денег клиента остаётся ${money(r.closingDebt)} долга. Нужно изменить цену или расходы.`
    : 'По заданным условиям денег на одну заявку хватает. Подтвердите даты, документы и доступность источников.';
  $('liquidity-verdict').textContent = verdict;
  $('liquidity-verdict').classList.toggle('ok', r.executionReady);
  $('liquidity-dot').classList.toggle('ok', r.executionReady);
  const warnings = r.warnings.filter(w => w.code !== 'FUNDING_GAP' && w.code !== 'CLOSING_DEBT').map(w => w.message);
  if (r.profit < 1000) warnings.unshift(r.profit < 0 ? 'При этих условиях сделка убыточна. Поднимите цену, сократите разрыв или снизьте расходы.' : 'До ориентировочного минимума 1 000 ₽ прибыли не хватает. Посмотрите минимальные цены ниже.');
  if (r.monthlyBankFeesGross > 0) warnings.push(`Полные месячные платы банку: ${money(r.monthlyBankFeesGross)} с НДС комиссий. В прибыль заявки вошла распределённая доля; календарь этих месячных платежей здесь не построен.`);
  if (r.cashFeeVAT > 0) warnings.push(`НДС банковских комиссий ${money(r.cashFeeVAT)} на заявку требует денег до вычета. В прибыль он не включён при условии законного вычета.`);
  if (r.factorUsed) warnings.push(`Фактор перечислит ${money(r.factorAdvance)} до удержания комиссии в день ${r.factorDay}. Это не деньги в день 0.`);
  if (state.supplierDay > r.paymentDay) warnings.push('Поставщик получает оплату после клиента. Это работает только при подтверждённой отсрочке поставщика.');
  $('warnings').innerHTML = warnings.map(text => `<li>${esc(text)}</li>`).join('');
  $('minimum-cards').innerHTML = [1000, 2000, 3000].map(target => {
    const min = minimumMarkup(state, target);
    return `<article class="minimum-card"><span>Прибыль ${whole.format(target)} ₽</span><strong>${min ? money(min.price) : 'Не достигнуть'}</strong><small>${min ? `Добавить ${money(min.markup)}` : 'В пределах добавки до 1 млн ₽'}</small>${min ? `<button type="button" data-markup="${min.markup}" aria-label="Подставить наценку ${esc(money(min.markup))} для прибыли ${target} рублей">Подставить</button>` : ''}</article>`;
  }).join('');
}
function renderRecommendations() {
  const advice = currentAdvice();
  const labels = advice.profiles.filter(row => row.id !== 'current');
  $('scenario-table').innerHTML = labels.map(row => `<tr><th scope="row">${esc(row.label)}</th><td class="${row.result.profit < 0 ? 'negative' : 'positive'}">${money(row.result.profit)}<small>${row.result.executionReady ? 'Источники отмечены' : 'Требует подтверждения / денег'}</small></td><td>${money(row.result.peakFundingNeed)}</td><td>${money(row.result.uncoveredGap)}</td></tr>`).join('');
  const winner = advice.best || advice.candidate;
  if (!winner) {
    $('recommendation').innerHTML = advice.noProtection ? '<p class="recommend-label caution">Сначала подтвердите защиту от неплатежа</p><p class="recommend-text">Для этого клиента не найден вариант с подтверждённой защитой. Получите 100% аванс, одобренный полис или согласованный безрегрессный факторинг. Гарантию оплаты от клиента проверяйте отдельно.</p>' : '<p class="recommend-label caution">Нужны условия доступного источника денег</p><p class="recommend-text">Своих денег не хватает, а тариф заёмного источника не введён. Откройте условия продукта, заполните ставку, платы и отдельный подтверждённый лимит. Факторинг после приёмки не оплачивает начало заявки.</p>';
    return;
  }
  const theoretical = !advice.best;
  const difference = winner.result.profit - result.profit;
  const conditional = winner.result.profit < 0 ? 'Даже лучший сравниваемый вариант убыточен'
    : winner.result.profit < 1000 ? 'Лучший по расчёту, но ниже ориентира 1 000 ₽'
    : theoretical ? 'Кандидат для согласования с банком' : 'Лучший по прибыли среди доступных схем';
  $('recommendation').innerHTML = `<p class="recommend-label${theoretical || winner.result.profit < 1000 ? ' caution' : ''}">${conditional}</p><h3>${esc(winner.label)}</h3><div class="recommend-numbers"><strong class="${winner.result.profit < 0 ? 'negative' : 'positive'}">${money(winner.result.profit)}<small>прибыль / вагон</small></strong><span>${signed(difference)}<small>к выбранной схеме</small></span></div><p class="recommend-text">${theoretical ? `Для запуска нужны подтверждения: ${winner.result.uncoveredGap > 0 ? `не хватает ${money(winner.result.uncoveredGap)} подтверждённых денег. ` : ''}${winner.result.factorUsed && !state.factorConfirmed ? 'Нужно одобрение фактора. ' : ''}` : 'Подтверждённых вами источников по модели хватает на одну заявку. '}${winner.result.factorUsed ? `Фактор нужен с дня ${winner.result.factorDay} до дня ${winner.result.paymentDay}; до выплаты нужен другой источник.` : 'В этой схеме факторинг не используется.'}</p>${winner.result.profit < 1000 ? '<p class="recommend-text">До изменения цены или условий ориентир прибыли не выполнен. Используйте таблицу минимальных цен.</p>' : ''}<p class="micro-note">Сравниваем свои деньги, оба банковских продукта при введённых условиях, страхование и факторинг. Лучший вариант выбираем по прибыли среди отмеченных источников и подходящей защиты клиента. Покрытие действует только в пределах договора; срок выплаты страховки и полная неоплата в прибыль не заложены.</p>`;
}
function renderTimeline() {
  const actual = result.timeline.map(event => ({ ...event, events: event.label.split('; ') }));
  if (!actual.some(event => event.day === state.acceptanceDay)) actual.push({ day: state.acceptanceDay, cash: 0, events: ['Выполнено и принято'], loanNeed: null });
  else actual.find(event => event.day === state.acceptanceDay).events.push('Выполнено и принято');
  actual.sort((a, b) => a.day - b.day);
  $('timeline').innerHTML = actual.map(event => `<article class="timeline-item"><p class="timeline-day">ДЕНЬ ${event.day}</p><h3>${esc(event.events[0])}</h3>${event.events.length > 1 ? `<ul>${event.events.slice(1).map(label => `<li>${esc(label)}</li>`).join('')}</ul>` : ''}<strong>${event.cash === 0 ? 'Документы / событие' : signed(event.cash)}</strong><small>${event.cash === 0 ? 'Само событие не перечисляет деньги.' : 'Итог входящих и исходящих платежей этого дня, до процентов.'}${event.loanNeed !== null ? `<br>Дополнительный источник нужен на ${money(event.loanNeed)}.` : ''}</small></article>`).join('');
}
function renderImpact() {
  const definitions = [
    ['fundingKind', 'Заёмные деньги', state.fundingKind !== 'none', { fundingKind: state.fundingKind !== 'none' ? 'none' : 'credit' }, 'Кредит оплачивает кассовый разрыв. Потребность сделки остаётся; меняется источник и цена денег.'],
    ['factorEnabled', 'Факторинг', state.factorEnabled, { factorEnabled: !state.factorEnabled }, 'Сокращает срок кредита после выплаты. Комиссия и неполная первая выплата могут съесть преимущество.'],
    ['insuranceEnabled', 'Страхование', state.insuranceEnabled, { insuranceEnabled: !state.insuranceEnabled }, 'В математике уменьшает прибыль на премию и её финансирование. В жизни покрывает только согласованный риск.'],
    ['guaranteeEnabled', 'Ваша гарантия', state.guaranteeEnabled, { guaranteeEnabled: !state.guaranteeEnabled }, 'Даёт контрагенту обеспечение обязательства. Комиссия — расход, денежный залог — временная потребность.'],
    ['lcEnabled', 'Аккредитив', state.lcEnabled, { lcEnabled: !state.lcEnabled }, 'Деньги резервируются раньше оплаты поставщика; поставщику платим из покрытия. Дополнительно нужны комиссия и непокрытая часть.'],
    ['accountEnabled', 'Месячный тариф счёта', state.accountEnabled, { accountEnabled: !state.accountEnabled }, 'Фиксированную плату распределяем на выбранное число вагонов, независимо от короткой отсрочки.'],
  ];
  $('tool-impact').innerHTML = definitions.map(([key, label, active, patch, note]) => {
    const alternative = calculate({ ...state, ...patch });
    const profitChange = alternative.profit - result.profit;
    const cashChange = alternative.peakFundingNeed - result.peakFundingNeed;
    return `<article class="impact-card"><span class="impact-action">${active ? 'ЕСЛИ УБРАТЬ' : 'ЕСЛИ ДОБАВИТЬ'}</span><h3>${label}</h3><dl><div><dt>Прибыль изменится</dt><dd class="${profitChange < 0 ? 'negative' : profitChange > 0 ? 'positive' : ''}">${signed(profitChange)}</dd></div><div><dt>Пик нужных денег</dt><dd>${signed(cashChange)}</dd></div></dl><p>${note}</p></article>`;
  }).join('');
  const stress = [
    ['Клиент задержит ещё на 7 дней', state.lateDays <= 3643 ? calculate({ ...state, lateDays: state.lateDays + 7 }) : null, 'Проверьте запас прибыли и срок погашения банка.'],
    ['Клиент задержит ещё на 14 дней', state.lateDays <= 3636 ? calculate({ ...state, lateDays: state.lateDays + 14 }) : null, 'Просрочка банка может стоить больше обычного процента; штрафов в этом расчёте нет.'],
    state.factorEnabled ? ['Фактор не перечислил деньги', calculate({ ...state, factorUnavailable: true }), 'Месячная плата фактора остаётся. Разовые комиссии за невыполненное финансирование не начислены; проверьте договор.'] : ['Поставщик потребовал оплату сразу', calculate({ ...state, supplierDay: 0 }), 'Согласованная отсрочка поставщика больше не помогает; нужен источник в день 0.'],
  ];
  $('stress-cards').innerHTML = stress.map(([label, r, note]) => `<article class="stress-card"><h3>${label}</h3><strong class="${r && r.profit < 0 ? 'negative' : ''}">${r ? money(r.profit) : 'За пределами модели'}</strong><span>прибыль / вагон</span><p>${r ? `Изменение: <b>${signed(r.profit - result.profit)}</b>. Денег не хватает: <b>${money(r.uncoveredGap)}</b>. ` : ''}${esc(note)}</p></article>`).join('');
}
function renderRisk() {
  const risk = {
    reliable: ['История помогает, но не гарантирует оплату', ['Проверяйте подтверждённые документы и дату оплаты, а не только обещание менеджера.', 'Согласуйте предел долга клиента и общий лимит оборотных денег.', 'Посмотрите прибыль при задержке на 7–14 дней. Кредит не страхует неплатёж.']],
    late: ['Просрочку нужно заложить до согласования цены', ['Введите реальную ожидаемую задержку в блок сроков.', 'Запросите одобренное покрытие: полис либо безрегрессный факторинг с понятными исключениями.', 'Начните с меньших партий, уменьшите отсрочку или получите аванс. При нарушении срока остановите новые неоплаченные отгрузки.']],
    new: ['Желание работать не должно создавать открытый долг', ['Начните со 100% аванса либо подтверждённой защиты на данного покупателя и сумму.', 'Проверьте покупателя, полномочия подписанта, договор, условия приёмки и реальный источник его денег.', 'Без подтверждённой защиты не рекомендуем необеспеченную отсрочку. Маленькая первая партия уменьшает размер риска, но не устраняет его.']],
  }[state.clientRisk];
  $('risk-advice').innerHTML = `<h3>${risk[0]}</h3><ol>${risk[1].map(item => `<li>${item}</li>`).join('')}</ol><p>${state.factorEnabled && state.factorRecourse ? 'Сейчас выбран факторинг с регрессом: долг покупателя может вернуться к вам.' : state.insuranceEnabled && !state.insuranceConfirmed ? 'Страхование посчитано в расходах, но одобрение полиса пока не отмечено.' : 'Любую защиту проверяйте по договору: доля покрытия, лимиты, исключения, срок и документы.'}</p>`;
}
function renderPrices() {
  if (!result) return;
  priceRows = Array.from({ length: 21 }, (_, index) => {
    const purchase = 50000 + index * 5000;
    return { purchase, minima: [1000, 2000, 3000].map(target => minimumMarkup({ ...state, purchase }, target)) };
  });
  $('prices-table').innerHTML = priceRows.map(row => `<tr><th scope="row">${money(row.purchase)}</th>${row.minima.map(min => `<td>${min ? money(min.price) : 'Не достигнуть'}<small>${min ? `+ ${money(min.markup)}` : 'Добавка до 1 млн ₽'}</small></td>`).join('')}</tr>`).join('');
}
function textSummary() {
  const r = result;
  const advice = currentAdvice();
  const winner = advice.best || advice.candidate;
  return [`Экономика вагона · ${new Date().toLocaleDateString('ru-RU')}`, meeting?.selected.quote ? `Для прибыли ${money(state.targetProfit)} после банка и расходов, до налога на прибыль: цена ${money(meeting.selected.quote.price)} с НДС, добавить ${money(meeting.selected.quote.markup)}. Выбрано: ${humanScheme(state)}.` : 'Цена для цели не рассчитана.', `Закупка: ${money(state.purchase)} с НДС; ваша наценка: ${money(state.markup)} с НДС.`, `Ваша нынешняя цена клиенту: ${money(r.invoiceGross)} с НДС ${state.vatPercent}%.`, `Отсрочка: ${state.clientDays} дней ${state.delayAnchor === 'acceptance' ? 'после приёмки' : 'от начала заявки'}; задержка: ${state.lateDays}. День денег: ${r.paymentDay}.`, `Заёмные деньги: ${state.fundingKind === 'none' ? 'не используются' : state.fundingKind === 'line' ? 'ВКЛ' : 'Точка'}; начисление: ${state.fundingInterestMode === 'annual_daily' ? `${state.fundingRate}% годовых по дням` : `${state.fundingMonthlyRate}% в месяц, база ${state.fundingMonthlyBase === 'initial' ? 'первоначальная сумма' : 'остаток'}`} ; подтверждённый лимит: ${money(state.fundingLimit)}.`, `Факторинг: ${state.factorEnabled ? `включён, ${state.factorRate}% годовых, выплата ${state.factorAdvancePercent}%, день ${r.factorDay}, ${state.factorRecourse ? 'с регрессом' : 'без регресса'}, ${state.factorConfirmed ? 'одобрение отмечено' : 'не подтверждён'}` : 'выключен'}.`, `Страхование: ${state.insuranceEnabled ? `${state.insurancePercent}% всего счёта; ${state.insuranceConfirmed ? 'одобрение отмечено' : 'не подтверждено'}` : 'выключено'}.`, `Банковские расходы при вашей цене: ${money(Object.values(r.breakdown).reduce((sum, value) => sum + value, 0) - r.overheadPerWagon)} без возмещаемого НДС.`, `Полные месячные платы банку: ${money(r.monthlyBankFeesGross)} с НДС.`, `Расходы компании: ${money(state.monthlyOverhead)} / ${state.volume} вагонов = ${money(r.overheadPerWagon)} на вагон.`, `Прибыль при вашей цене после банка и расходов, до налога на прибыль: ${money(r.profit)}.`, `Непокрытая потребность в деньгах при вашей цене: ${money(r.uncoveredGap)}. ${r.executionReady ? 'Источники по модели отмечены для 1 заявки.' : 'Запуск требует подтверждённых денег или условий.'}`, winner ? `${advice.best ? 'Лучший среди доступных схем при вашей цене' : 'Кандидат на согласование'}: ${winner.label}, прибыль ${money(winner.result.profit)}.` : 'Для этого клиента защита не подтверждена; схема не рекомендована.', 'Ставки и покрытие — введённые допущения. Налоговый календарь, штрафы, простой и полная неоплата в расчёт не включены.'].join('\n');
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', event => {
  if (event.target.type === 'checkbox' || event.target.tagName === 'SELECT') return;
  clearTimeout(timer);
  timer = setTimeout(render, 120);
});
form.addEventListener('change', event => {
  clearTimeout(timer);
  if (event.target.dataset.goal) $('targetProfit').value = event.target.value;
  if (event.target.name === 'fundingInterestMode' && event.target.value !== 'monthly_full') $('fundingMonthlyUpfront').checked = false;
  if (event.target.name === 'altInterestMode' && event.target.value !== 'monthly_full') $('altMonthlyUpfront').checked = false;
  if (event.target.id === 'fundingEnabled') {
    $('fundingKind').value = event.target.checked ? state.primaryFundingKind : 'none';
  } else if (event.target.name === 'fundingKind') {
    try {
      const draft = readForm();
      state = selectFundingProfile(draft, event.target.value);
      fillForm();
    } catch (error) {
      $('fundingKind').value = state.fundingKind;
      $('fundingEnabled').checked = state.fundingKind !== 'none';
      syncCards();
      renderError(error); return;
    }
  }
  render();
});
form.addEventListener('focusout', event => {
  if (numbers.has(event.target.name) && !event.target.hasAttribute('aria-invalid')) {
    const n = Number(event.target.value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    if (Number.isFinite(n) && event.target.value.trim()) event.target.value = inputDecimal.format(n);
  }
});
document.addEventListener('click', event => {
  const settings = event.target.closest('[data-open-settings]');
  if (settings) {
    event.preventDefault(); $('advanced-settings').open = true;
    $('advanced-settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const quickTool = event.target.closest('[data-quick-tool]');
  if (quickTool) {
    const original = $(quickTool.dataset.quickTool);
    original.checked = !original.checked;
    meetingAction = 'tool';
    original.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const offerButton = event.target.closest('[data-select-offer]');
  if (offerButton && meeting) {
    const offer = meeting.offers.find(candidate => candidate.id === offerButton.dataset.selectOffer);
    if (offer) {
      try {
        const draft = readForm(); calculate(draft);
        state = { ...selectFundingProfile(draft, offer.params.fundingKind), factorEnabled: offer.params.factorEnabled, insuranceEnabled: offer.params.insuranceEnabled };
        fillForm(); meetingAction = 'scheme'; render();
      } catch (error) { renderError(error); }
    }
  }
  const dayButton = event.target.closest('[data-days]');
  if (dayButton) { $('clientDays').value = dayButton.dataset.days; render(); }
  const priceButton = event.target.closest('[data-markup]');
  if (priceButton) { $('markup').value = decimal.format(Number(priceButton.dataset.markup)); render(); }
});
$('price-details').addEventListener('toggle', () => { if ($('price-details').open) renderPrices(); });
$('reset').addEventListener('click', () => {
  clearTimeout(timer);
  state = initialState();
  lastQuotePrice = null;
  fillForm(); render(); $('action-status').textContent = 'Исходный пример восстановлен.';
});
$('apply-tochka').addEventListener('click', () => {
  try { state = { ...selectFundingProfile(readForm(), 'credit'), ...TOCHKA_PROFILE, fundingTermsKnown: true }; fillForm(); render(); }
  catch (error) { renderError(error); }
});
$('apply-line').addEventListener('click', () => {
  try { const draft = selectFundingProfile(readForm(), 'line'); const approved = draft.fundingLimit; state = { ...draft, ...LINE_PROFILE, fundingLimit: approved }; fillForm(); render(); }
  catch (error) { renderError(error); }
});
$('copy-meeting').addEventListener('click', () => $('copy-result').click());
$('apply-quote').addEventListener('click', () => {
  render(); if (!meeting?.selected.quote) return;
  $('markup').value = inputDecimal.format(meeting.selected.quote.markup);
  render(); $('meeting-status').textContent = 'Цена применена: наценка обновилась, прибыль при вашей цене теперь соответствует цели.';
});
$('copy-result').addEventListener('click', async () => {
  render(); if (!result) return;
  try { await navigator.clipboard.writeText(textSummary()); $('action-status').textContent = 'Расчёт скопирован. Его можно вставить в сообщение.'; $('meeting-status').textContent = 'Цена и условия скопированы.'; }
  catch {
    const previous = document.getElementById('manual-copy');
    if (previous) previous.remove();
    const area = document.createElement('textarea');
    area.id = 'manual-copy'; area.value = textSummary(); area.readOnly = true;
    area.setAttribute('aria-label', 'Расчёт для ручного копирования');
    $('copy-meeting').after(area); area.focus(); area.select();
    $('action-status').textContent = 'Браузер запретил копирование. Выделите текст в поле и скопируйте вручную.';
    $('meeting-status').textContent = 'Выделите текст в поле ниже и скопируйте вручную.';
  }
});
$('print-result').addEventListener('click', () => { render(); if (result) { $('calculation-details').open = true; window.print(); } });
$('download-prices').addEventListener('click', () => {
  if (!result) return;
  renderPrices();
  const rows = [['Экономика вагона — цены с НДС; прибыль после банка и расходов, до налога на прибыль'], [`Отсрочка ${state.clientDays} дней; начало ${state.delayAnchor === 'acceptance' ? 'после приёмки' : 'день 0'}; задержка ${state.lateDays} дней; НДС ${state.vatPercent}%`], ['Закупка с НДС', 'Цена: прибыль 1000', 'Добавка: прибыль 1000', 'Цена: прибыль 2000', 'Добавка: прибыль 2000', 'Цена: прибыль 3000', 'Добавка: прибыль 3000'], ...priceRows.map(row => [row.purchase, ...row.minima.flatMap(min => min ? [min.price, min.markup] : ['Не достигнуть', ''])])];
  const blob = new Blob(['\ufeff', rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'Минимальные_цены_вагон.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

loadSaved(); fillForm(); render();
if (!storageAvailable) document.querySelector('.site-footer p').append(' Автосохранение недоступно в этом браузере.');
