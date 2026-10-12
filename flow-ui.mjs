/** Rendering only: portfolio economics and liquidity stay in portfolio.mjs. */
export function mountFlowControls(doc, { numberField, fieldGrid, selectField }) {
  const mode = doc.createElement('fieldset');
  mode.className = 'mode-selector';
  mode.innerHTML = '<legend>Что рассчитываем</legend><div class="mode-options"><label><input type="radio" name="calculationMode" value="single"><span>Одна заявка</span></label><label><input type="radio" name="calculationMode" value="flow"><span>Постоянный объём</span></label></div><p id="mode-explanation"></p>';
  const quick = doc.getElementById('deal');
  quick.querySelector('.section-heading').after(mode);
  const controls = doc.createElement('div'); controls.id = 'flow-controls'; controls.className = 'flow-controls'; controls.hidden = true;
  controls.innerHTML = fieldGrid(numberField('flowMonthlyVolume', 'Вагонов в месяц на этих деньгах', 'шт.', 'Только этот поток. Общий объём компании задаётся отдельно.'), numberField('flowMonths', 'Срок плана и кредита', 'мес.', 'От 3 до 12. Для Точки задаёт срок кредитного сценария.'))
    + numberField('flowLoanAmount', 'Сумма кредита / плановый лимит ВКЛ', '₽', 'Одна сумма на весь поток. Повторное использование денег не означает новую выдачу каждый вагон.')
    + selectField('flowDispatch', 'Когда закупаем вагоны', [['uniform', 'Постепенно в течение месяца'], ['monthly_batch', 'Весь месячный объём сразу']])
    + '<p class="flow-controls-note">План новых заявок с одинаковыми ценами. Старые неоплаченные счета и прежние кредиты сюда автоматически не добавляются. Свои свободные деньги, отдельный резерв для банка и одобренные лимиты — в <a href="#advanced-settings" data-open-settings>условиях</a>.</p>';
  quick.querySelector('.goal-selector').before(controls);
  const report = doc.createElement('section'); report.id = 'flow-report'; report.className = 'panel flow-report'; report.hidden = true;
  report.innerHTML = '<p class="eyebrow">ПЛАН ДЕНЕГ И РАСХОДОВ</p><h2>Постоянный объём: весь расчёт</h2><p id="flow-report-heading"></p><div id="flow-report-body"></div><button type="button" id="print-flow" class="button secondary">Сохранить план в PDF</button>';
  doc.getElementById('calculation-details').after(report);
}

export function syncFlowMode(doc, state) {
  const flow = state.calculationMode === 'flow';
  doc.body.classList.toggle('flow-mode', flow);
  doc.getElementById('flow-controls').hidden = !flow;
  doc.getElementById('flow-report').hidden = !flow;
  doc.getElementById('calculation-details').hidden = flow;
  doc.getElementById('more-analysis').hidden = flow;
  doc.getElementById('mode-explanation').textContent = flow
    ? 'Один кредит обслуживает несколько вагонов. Его расходы делим на весь объём; отдельно проверяем ежемесячные платежи и оборотные деньги.'
    : 'Одна заявка оплачивает весь свой кредитный сценарий. Для повторных закупок на одном кредите выберите постоянный объём.';
  doc.querySelector('#deal .quick-tag').textContent = flow ? 'поток' : '1 вагон';
  doc.getElementById('ownCash').labels[0].textContent = flow ? 'Свои свободные деньги на весь поток' : 'Свои свободные деньги на заявку';
  doc.getElementById('flowLoanAmount').labels[0].textContent = state.primaryFundingKind === 'line' ? 'Плановый лимит ВКЛ на весь поток' : 'Первоначальная сумма кредита Точки';
}

export function flowAvailability(offer, money) {
  if (offer.error) return offer.error;
  if (!offer.quote) return 'Нужная прибыль не достигается.';
  if (!offer.contractEligible) return 'Плановая сумма кредита выходит за минимальную или максимальную сумму продукта.';
  if (!offer.riskSuitable) return 'Защита от неплатежа не подтверждена.';
  if (offer.quoteResult.cash.externalGap > .01) return `Плану не хватает ${money(offer.quoteResult.cash.externalGap)} оборотных денег.`;
  if (!offer.executionReadyQuote) return 'Деньги по плану сходятся; одобрение источников и условия ещё нужно подтвердить.';
  return 'По введённым условиям денег на план хватает.';
}

export function renderFlowMeeting(doc, state, meeting, { money, whole, esc, humanScheme }) {
  const get = id => doc.getElementById(id);
  const offer = meeting.selected, r = offer.currentResult, q = offer.quote, target = money(state.targetProfit);
  const atQuote = offer.quoteResult || r;
  const totalWagons = state.flowMonthlyVolume * state.flowMonths;
  get('invoice-price').textContent = money(state.purchase + state.markup);
  get('overhead-preview').textContent = `${money(state.monthlyOverhead / state.volume)} / вагон`;
  get('quick-overhead').innerHTML = `Расходы компании: ${money(state.monthlyOverhead / state.volume)} на вагон при общем объёме ${whole.format(state.volume)} в месяц. Поток на этих деньгах: ${whole.format(state.flowMonthlyVolume)} в месяц. <a href="#advanced-settings" data-open-settings>Изменить</a>`;
  get('quote-title').textContent = `Цена для средней прибыли ${target} / вагон`;
  get('quote-price').textContent = q ? money(q.price) : 'Цель не достигается';
  get('quote-markup').textContent = q ? `Добавить ${money(q.markup)} с НДС к каждому вагону.` : 'Выбранные условия не дают этой прибыли при добавке до 1 млн ₽.';
  get('quote-current-profit').innerHTML = `При вашей цене <b>${money(state.purchase + state.markup)}</b> средняя прибыль — <b>${money(r.profitPerWagon)}</b> на вагон после банка и расходов, до налога на прибыль.`;
  get('quote-explanation').innerHTML = `<b>${whole.format(state.flowMonthlyVolume)} вагонов в месяц × ${state.flowMonths} мес. = ${whole.format(totalWagons)} вагонов.</b> Все расходы этого кредитного сценария распределены на этот объём. Это план, а не подтверждённые будущие продажи.`;
  get('credit-summary').innerHTML = `<div class="flow-cost-strip"><div><span>Проценты / комиссии кредита за план</span><b>${money(r.creditInterest)}</b></div><div><span>Делим на весь объём</span><b>${whole.format(totalWagons)} вагонов</b></div><div><span>Процентный расход на вагон</span><b>${money(r.creditInterest / totalWagons)}</b></div></div><div class="flow-cash-warning${atQuote.cash.externalGap > .01 ? ' has-gap' : ''}"><b>${esc(flowAvailability(offer, money))}</b><p>Проверка денег относится к цене для цели. При вашей нынешней цене дополнительно требуется ${money(r.cash.externalGap)}. Возврат долга — не расход для прибыли, но реальные деньги для платежа банку.</p></div>`;
  if (state.fundingKind !== 'none' && state.fundingKind !== 'line' && state.fundingInterestMode === 'monthly_full') {
    get('credit-summary').insertAdjacentHTML('afterbegin', `<p class="flow-fee-formula">${money(state.flowLoanAmount)} × ${String(state.fundingMonthlyRate).replace('.', ',')}% за месяц × ${state.flowMonths} мес. = ${money(r.creditInterest)} процентных комиссий за весь план.</p><p>При том же числе вагонов в месяц более длинный срок увеличивает и комиссию, и объём. Расход комиссии на вагон от одного продления не падает.</p>`);
  }
  get('apply-quote').disabled = !q;
  for (const el of doc.querySelectorAll('[data-goal]')) el.checked = Number(el.dataset.goal) === state.targetProfit;
  for (const el of doc.querySelectorAll('[data-quick-tool]')) {
    el.setAttribute('aria-pressed', String(doc.getElementById(el.dataset.quickTool).checked));
    if (el.dataset.quickTool === 'fundingEnabled') el.textContent = state.primaryFundingKind === 'line' ? 'ВКЛ' : 'Точка';
  }
  const clientDay = (state.delayAnchor === 'acceptance' ? state.acceptanceDay : 0) + state.clientDays + state.lateDays;
  get('quick-date-note').textContent = `Клиент платит через ${clientDay} дней от каждой заявки. Фактор может дать деньги после приёмки: ${state.acceptanceDay + state.factorDelay}-й день.`;
  get('offers-title').textContent = `Один поток — разные схемы`;
  get('offers-intro').textContent = `В каждой схеме одинаковые ${whole.format(totalWagons)} вагонов за ${state.flowMonths} месяцев и плановая сумма ${money(state.flowLoanAmount)}. Сравниваем среднюю цену для цели и нехватку оборотных денег.`;
  const best = meeting.bestAvailable || meeting.bestCalculated;
  get('meeting-best').classList.toggle('caution', !meeting.bestAvailable);
  get('meeting-best').innerHTML = best ? `<strong>${meeting.bestAvailable ? 'Рекомендуем по введённым условиям' : 'Выгоднее по расчёту'}: ${esc(humanScheme(best.params))}.</strong><small>${esc(flowAvailability(best, money))}</small>`
    : `<strong>${meeting.noProtection ? 'Сначала подтвердите защиту от неплатежа.' : 'Для этого объёма нужен дополнительный источник денег.'}</strong><small>Цена может дать прибыль, а касса — не позволить оплатить закупки и банк. Уменьшите объём, увеличьте свои деньги или лимит, согласуйте аванс либо отсрочку поставщика.</small>`;
  get('offer-cards').innerHTML = meeting.compactOffers.map(item => {
    const active = item.params.fundingKind === state.fundingKind && item.params.factorEnabled === state.factorEnabled;
    return `<article class="offer-card${best?.id === item.id ? ' is-best' : ''}${active ? ' is-selected' : ''}" data-offer-card="${item.id}"><div class="offer-card-heading"><h3>${esc(humanScheme(item.params))}</h3>${best?.id === item.id ? `<span class="offer-badge">${meeting.bestAvailable ? 'Рекомендуем' : 'Выгоднее'}</span>` : ''}</div><p class="offer-price-label">Цена для средней прибыли ${target}</p><strong class="offer-price">${item.quote ? money(item.quote.price) : 'Не рассчитано'}</strong><p class="offer-markup">${item.quote ? `Добавить ${money(item.quote.markup)}` : 'Проверьте условия'}</p><div class="offer-metrics"><div><span>Прибыль при вашей цене / вагон</span><b class="${(item.currentResult?.profitPerWagon ?? 0) < 0 ? 'negative' : 'positive'}">${item.currentResult ? money(item.currentResult.profitPerWagon) : '—'}</b></div><div><span>Проценты кредита / вагон</span><b>${item.currentResult ? money(item.currentResult.creditInterest / totalWagons) : '—'}</b></div></div><p class="offer-availability">${item.quoteResult?.cash.externalGap > .01 ? `Не хватает ${money(item.quoteResult.cash.externalGap)}` : item.executionReadyQuote && item.riskSuitable ? 'Источники отмечены' : 'Нужны подтверждения'}</p><details class="offer-info"><summary>Как работает</summary><p>${esc(flowAvailability(item, money))}</p><p>Кредитная комиссия распределена на весь объём. Фактор ускоряет поступления; фиксированную комиссию Точки он не отменяет.</p></details><button type="button" data-select-offer="${item.id}"${active || item.error ? ' disabled' : ''}>${active ? 'Выбрана' : 'Выбрать'}</button></article>`;
  }).join('');
  get('launch-explainer').innerHTML = `<p><b>Два разных показателя.</b> Прибыль за весь план: ${money(r.totalProfit)}. Нехватка оборотных денег: ${money(r.cash.externalGap)}. Убыточные продажи нельзя исправить увеличением кредита.</p><small>Поток ${whole.format(state.flowMonthlyVolume)} вагонов в месяц — часть общего объёма ${whole.format(state.volume)}. Если других продаж нет, укажите общий объём равным этому потоку, чтобы учесть весь бюджет компании.</small>`;
  get('mobile-label').textContent = `Средняя прибыль ${target} / вагон`;
  get('mobile-profit').textContent = q ? money(q.price) : 'Проверьте условия';
  get('meeting-error').hidden = true;
  get('flow-report-heading').textContent = `${humanScheme(state)} · ${state.flowMonths} мес. · ${totalWagons} вагонов · ваша цена ${money(state.purchase + state.markup)}. Цена для средней прибыли ${target}: ${q ? money(q.price) : 'не достигается'}.`;
  const economicRows = Object.entries(r.breakdownPerWagon).filter(([,value]) => value !== 0).map(([name,value]) => `<tr><th scope="row">${esc({overhead:'Расходы компании',interest:'Проценты / комиссия кредита',fundingSetup:'Разовый сбор за финансирование',subscriptions:'Подписки и тариф счёта',factor:'Факторинг',insurance:'Страхование'}[name] || name)}</th><td>${money(value)}</td></tr>`).join('');
  const monthRows = r.months.map(month => `<tr><th scope="row">${month.month}<small>дни ${month.startDay}–${month.endDay}</small></th><td>${money(month.purchases)}</td><td>${money(month.receipts)}</td><td>${money(month.principal)}</td><td>${money(month.interest)}</td><td>${money(month.cashEnd)}</td></tr>`).join('');
  const balances = r.months.map(month => `<details class="flow-month"><summary><span>Период ${month.month}<small>Дни ${month.startDay}–${month.endDay}</small></span><b>${money(month.cashEnd)}</b></summary><dl>${[
    ['Свободные деньги в начале', month.cashStart], ['Поступления от клиентов / фактора', month.receipts], ['Получили от банка', month.drawn], ['Взяли из отдельного резерва', month.reserveUsed], ['Оплатили поставщикам', -month.purchases], ['Вернули банку долг', -month.principal], ['Проценты, комиссии и подписки', -month.interest - month.otherBankFees], ['Страхование', -month.insurance], ['Расходы компании', -month.overhead], ['Изменение свободных денег из-за резерва НДС', -month.vatReserve], ['Свободные деньги в конце', month.cashEnd],
  ].map(([label,value]) => `<div><dt>${esc(label)}</dt><dd>${money(value)}</dd></div>`).join('')}</dl></details>`).join('');
  get('flow-report-body').innerHTML = `<div class="flow-report-metrics"><div><span>Средняя прибыль / вагон</span><strong class="${r.profitPerWagon < 0 ? 'negative' : 'positive'}">${money(r.profitPerWagon)}</strong></div><div><span>Прибыль всего плана</span><strong>${money(r.totalProfit)}</strong></div><div><span>Возврат долга за весь график</span><strong>${money(r.principalRepaid)}</strong></div><div><span>Дополнительные деньги для плана</span><strong>${money(r.cash.externalGap)}</strong></div></div><details class="settings-details"><summary>Расходы на каждый вагон</summary><div class="table-scroll"><table><thead><tr><th>Расход</th><th>На вагон</th></tr></thead><tbody>${economicRows}</tbody></table></div></details><details class="settings-details"><summary>Закупки, поступления и банк по периодам</summary><p>Таблица относится к вашей цене. Первый период — дни 0–29, следующий — 30–59. Поэтому платёж дня 30 уже в следующем периоде; последний возврат долга может попасть в период после завершения закупок. Отрицательный остаток означает дополнительные деньги для плана. Платежи одного дня взаимно зачтены.</p><div class="table-scroll"><table><thead><tr><th>Период</th><th>Поставщикам</th><th>От клиентов / фактора</th><th>Вернём долг</th><th>Проценты / комиссия</th><th>Свободные деньги в конце</th></tr></thead><tbody>${monthRows}</tbody></table></div></details><details class="settings-details"><summary>Откуда берётся остаток денег: сверка по периодам</summary><p>Полученные кредиты и деньги из резерва увеличивают кассу, но не прибыль. Расходы со знаком минус уменьшают свободные деньги. НДС-резерв — отложенные деньги, а не второй расход для прибыли.</p>${balances}</details><p class="flow-tail-note">Неоплаченные счета на конец ${state.flowMonths}-го месяца: ${money(r.receivables.atHorizon)}. Последние поступления — на ${r.receivables.tailEndDay}-й день от начала плана. Они не заменяют деньги для более раннего платежа банку.</p><details class="settings-details"><summary>Что означает расчёт и что проверить</summary><ul>${r.warnings.map(warning => `<li>${esc(typeof warning === 'string' ? warning : warning.message)}</li>`).join('')}</ul><p>Защита клиента, условия регресса и одобрение проверяются отдельно. При отказе фактора отключите его и сравните нехватку денег. При задержке клиента добавьте дни в условиях. Налог на прибыль, штрафы и полный неплатёж не рассчитаны. Правила НДС: <a href="https://www.nalog.gov.ru/rn77/taxation/taxes/nds/" target="_blank" rel="noopener noreferrer">ФНС России</a>.</p></details>`;
}

export function flowTextSummary(state, meeting, { money, humanScheme }) {
  const r = meeting.selected.currentResult, q = meeting.selected.quote;
  return [`Постоянный объём · ${humanScheme(state)}`, `План: ${state.flowMonthlyVolume} вагонов/мес. × ${state.flowMonths} мес. = ${state.flowMonthlyVolume * state.flowMonths} вагонов.`, `Закупка ${money(state.purchase)}, текущая цена ${money(state.purchase + state.markup)} с НДС.`, `Плановая сумма кредита / лимит: ${money(state.flowLoanAmount)}.`, `Комиссии/проценты за план ${money(r.creditInterest)}, на вагон ${money(r.creditInterest / (state.flowMonthlyVolume * state.flowMonths))}.`, `Средняя прибыль при текущей цене ${money(r.profitPerWagon)} / вагон, всего ${money(r.totalProfit)} до налога на прибыль.`, `Цель ${money(state.targetProfit)} / вагон: ${q ? `цена ${money(q.price)}, добавить ${money(q.markup)} с НДС` : 'не достигается'}.`, `При цене для цели: ${flowAvailability(meeting.selected, money)}`, `При нынешней цене не хватает ${money(r.cash.externalGap)} оборотных денег.`, `Общий объём компании ${state.volume} вагонов/мес.; расходы компании ${money(state.monthlyOverhead)} / месяц.`, 'НДС резервируется по модели; банковский график и одобрение нужно сверить. Возврат долга не является расходом для прибыли.'].join('\n');
}
