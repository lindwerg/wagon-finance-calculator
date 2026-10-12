/** Progressive disclosure: the meeting screen precedes contract settings and reports. */
export function mountMeetingLayout(doc) {
  const get = id => doc.getElementById(id);
  doc.body.classList.add('meeting-mode');
  doc.querySelector('.hero-text').innerHTML = '<p class="eyebrow">КАЛЬКУЛЯТОР ДЛЯ ПЕРЕГОВОРОВ</p><h1 id="hero-title">Какую цену дать клиенту</h1><p>Закупка, наценка и срок оплаты → сравнение схем и цена для нужной прибыли.</p>';
  doc.querySelector('.rail-illustration').remove();
  doc.querySelector('nav').innerHTML = '<a href="#advanced-settings" data-open-settings>Условия</a><a href="#meeting-offers">Схемы</a>';
  doc.querySelector('.header-note').remove();
  doc.querySelector('.assumption-banner').innerHTML = '<p>Цены <b>с НДС</b>. ВКЛ 23,5% годовых — пример; Точка 2,49% в месяц — из вашего предложения. Тарифы меняются в «Условиях».</p>';

  const quick = get('deal');
  quick.classList.add('quick-panel');
  quick.querySelector('.section-heading').innerHTML = '<h2 id="deal-title">Ваша заявка</h2><span class="quick-tag">1 вагон</span>';
  get('purchase').labels[0].innerHTML = 'Закупка <span>с НДС</span>';
  get('markup').labels[0].innerHTML = 'Ваша наценка <span>с НДС</span>';
  get('purchase-help').textContent = 'Сколько стоит поставщик.';
  get('markup-help').textContent = 'Добавка до банка и расходов.';
  const budget = get('budget-details');
  const invoice = quick.querySelector('.invoice-preview');
  invoice.querySelector('span').textContent = 'Ваша цена: закупка + наценка';

  const days = get('clientDays').closest('.field');
  days.classList.add('quick-days');
  get('clientDays').labels[0].textContent = 'Отсрочка клиента';
  const anchor = get('delayAnchor').closest('.field');
  anchor.classList.add('quick-anchor');
  get('delayAnchor').labels[0].textContent = 'Считаем отсрочку';
  get('delayAnchor').options[0].textContent = 'От начала заявки';
  get('delayAnchor').options[1].textContent = 'После выполнения и приёмки';
  quick.insertBefore(days, invoice);
  quick.insertBefore(anchor, invoice);
  const dateNote = doc.createElement('p');
  dateNote.id = 'quick-date-note'; dateNote.className = 'quick-date-note';
  quick.insertBefore(dateNote, invoice);
  const goals = doc.createElement('fieldset');
  goals.className = 'goal-selector';
  goals.innerHTML = '<legend>Хочу заработать с вагона</legend><input type="hidden" id="targetProfit" name="targetProfit"><div class="goal-choices">' + [1000, 2000, 3000, 4000, 5000].map(goal => `<label><input type="radio" name="goalPreset" value="${goal}" data-goal="${goal}"><span>${goal / 1000} 000 ₽</span></label>`).join('') + '</div><small>После банка и расходов компании, до налога на прибыль.</small>';
  goals.insertAdjacentHTML('beforeend', '<small id="quick-overhead"></small>');
  quick.insertBefore(goals, invoice);
  const manual = doc.createElement('p');
  manual.className = 'manual-price-note'; manual.id = 'manual-price-note';
  manual.textContent = 'Ваша цена задана наценкой. Банк меняет прибыль и нужную цену ниже.';
  quick.insertBefore(manual, budget);

  const quote = doc.createElement('section');
  quote.id = 'meeting-quote'; quote.className = 'meeting-quote';
  quote.setAttribute('aria-labelledby', 'quote-title');
  quote.innerHTML = '<div class="quote-top"><h2 id="quote-title">Цена для нужной прибыли</h2><span class="quick-tag">с НДС</span></div><div class="quick-tools" role="group" aria-label="Выбранные инструменты"><button type="button" data-quick-tool="fundingEnabled">Кредит</button><button type="button" data-quick-tool="factorEnabled">Факторинг</button><button type="button" data-quick-tool="insuranceEnabled">Страхование</button></div><strong id="quote-price" class="quote-price">—</strong><p id="quote-markup" class="quote-markup"></p><p id="quote-current-profit" class="quote-current-profit"></p><p id="quote-explanation" class="quote-explanation"></p><button type="button" id="apply-quote" class="apply-quote">Поставить эту цену</button><p id="meeting-status" class="meeting-status" role="status"></p>';
  const offers = doc.createElement('section');
  offers.id = 'meeting-offers'; offers.className = 'meeting-offers';
  offers.innerHTML = '<div class="offers-heading"><h2 id="offers-title">Какая схема выгоднее</h2><a href="#advanced-settings" data-open-settings>Тарифы и лимиты</a></div><p class="offers-intro" id="offers-intro"></p><div id="meeting-best" class="meeting-best"></div><div id="offer-cards" class="offer-cards"></div><div id="launch-explainer" class="launch-explainer"></div>';
  const error = doc.createElement('div');
  error.id = 'meeting-error'; error.className = 'form-error'; error.hidden = true;
  error.setAttribute('role', 'alert');

  const advanced = doc.createElement('details');
  advanced.id = 'advanced-settings'; advanced.className = 'meeting-details panel';
  advanced.innerHTML = '<summary><span><b>Изменить условия</b><small>Свои деньги, расходы, приёмка, ставки, платы и лимиты</small></span></summary><div class="advanced-content"></div>';
  const advancedContent = advanced.querySelector('.advanced-content');
  advancedContent.append(budget, get('timing'), get('instruments'), get('risk'));
  for (const section of advancedContent.querySelectorAll('section.panel')) {
    section.querySelector('.step')?.remove();
    section.querySelector('.eyebrow')?.remove();
  }
  advancedContent.querySelector('#timing-title').textContent = 'Приёмка, задержка и оплата поставщика';
  advancedContent.querySelector('#instruments-title').textContent = 'Тарифы и подтверждённые лимиты';
  get('calculator').append(error, quote, offers, advanced);

  const report = doc.createElement('details');
  report.id = 'calculation-details'; report.className = 'meeting-details panel full-report';
  report.innerHTML = '<summary><span><b>Проверить расчёт по шагам</b><small>НДС, банк, расходы, прибыль и деньги для запуска</small></span></summary>';
  get('result').parentElement.append(report);
  report.append(get('result'));

  const more = doc.createElement('details');
  more.id = 'more-analysis'; more.className = 'meeting-details panel more-analysis';
  more.innerHTML = '<summary><span><b>Таблицы, риски и объяснения</b><small>Цены 50–150 тыс. ₽, просрочки, отказ фактора и формулы</small></span></summary>';
  const sections = [...doc.querySelectorAll('main > .wide-section, main > .method-section')];
  if (sections.length) sections[0].before(more);
  for (const section of sections) more.append(section);

  const bottom = doc.querySelector('.mobile-result');
  bottom.href = '#meeting-quote';
  bottom.innerHTML = '<span><span id="mobile-label">Цена для прибыли</span><b id="mobile-profit">—</b></span><span class="mobile-action">К цене</span>';
}
