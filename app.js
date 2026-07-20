(function () {
  "use strict";

  const STORAGE_KEY = "truebalance-budget-v1";
  const LEGACY_STORAGE_KEY = "northstar-budget-v1";
  const CLOUD_SESSION_KEY = "truebalance-cloud-session-v1";
  const CLOUD_CONFIG = globalThis.TRUEBALANCE_SUPABASE || {};
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const SHORT_MONTHS = MONTHS.map(month => month.slice(0, 3));
  const COLORS = ["#79e7bc","#a99af8","#76b6ff","#f3c969","#ff8e9f","#65d1e8","#d19af8","#8bc67c","#ef9f71","#9aa7ff"];
  const RECURRING_ICONS = ["🧾","🏠","🔑","💡","💧","📱","🌐","🚙","🛡️","🎧","📺","🎮","💪","☁️","🐾","🎓","💳","✨"];
  const CATEGORY_EMOJIS = { housing:"🔑", rent:"🔑", car:"🚙", transportation:"🚙", groceries:"🥑", grocery:"🥑", dining:"🍔", restaurants:"🍔", clothing:"👕", personal:"👕", entertainment:"🎟️", utilities:"🏠", insurance:"🛡️", bills:"🧾", subscriptions:"📱", "zip payments":"💳", other:"✨" };
  const DEFAULT_TAB_ORDER = ["dashboard","monthly","transactions","recurring","debts","zip","calendar","categories"];
  const DEFAULT_DASHBOARD_ORDER = ["cashflow","annual-spending","recurring-overview","credit-debt-overview","monthly-spending","income-categories","highlights"];
  const DASHBOARD_WIDGET_LABELS = { "cashflow":"Cash flow by month", "annual-spending":"Annual spending", "recurring-overview":"Recurring bills & subscriptions", "credit-debt-overview":"Credit card debts", "monthly-spending":"Monthly spending", "income-categories":"Income categories", "highlights":"Year highlights" };
  const DEFAULT_DASHBOARD_SIZES = {
    "cashflow": { width: "wide", height: "normal", font: "standard" },
    "annual-spending": { width: "small", height: "normal", font: "standard" },
    "recurring-overview": { width: "full", height: "tall", font: "standard" },
    "credit-debt-overview": { width: "full", height: "tall", font: "standard" },
    "monthly-spending": { width: "full", height: "tall", font: "standard" },
    "income-categories": { width: "half", height: "normal", font: "standard" },
    "highlights": { width: "half", height: "normal", font: "standard" }
  };
  const VIEW_META = {
    dashboard: ["OVERVIEW", "Dashboard"],
    monthly: ["PLAN & TRACK", "Monthly budget"],
    transactions: ["ACTIVITY", "Transactions"],
    recurring: ["RECURRING PAYMENTS", "Bills & subscriptions"],
    debts: ["CREDIT PAYOFF", "Credit debt"],
    zip: ["BUY NOW, PAY LATER", "ZIP payments"],
    calendar: ["PAYMENT DATES", "Calendar"],
    categories: ["CUSTOMIZE", "Categories"],
    settings: ["PREFERENCES", "Settings & data"]
  };

  const app = document.getElementById("app");
  const pageTitle = document.getElementById("pageTitle");
  const pageEyebrow = document.getElementById("pageEyebrow");
  const headerYear = document.getElementById("headerYear");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalForm = document.getElementById("modalForm");
  const modalTitle = document.getElementById("modalTitle");
  const modalEyebrow = document.getElementById("modalEyebrow");
  const importInput = document.getElementById("importInput");
  let cloudSession = loadCloudSession();
  let cloudTimer = null;
  let cloudBusy = false;
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeStatus = "offline";
  let applyingRemoteCloud = false;
  let cloudShareCode = "";

  const makeId = () => (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  function freshMonth() {
    return { income: {}, incomeEntries: [], budgets: {}, weeklyBudgets: Array.from({ length: 5 }, () => ({})), debt: {}, savings: {}, transactions: [], notes: "", todos: [] };
  }

  function defaultData() {
    const year = new Date().getFullYear();
    return {
      version: 2,
      settings: { year, currency: "USD", name: "My budget", fontSize: "standard", visualTheme: "midnight", accentColor: "#63b3ff", cornerStyle: "rounded", density: "comfortable", categoryStyle: "pills", designVersion: 2, sidebarCollapsed: false, hiddenDashboardWidgets: [], hiddenBoxes: {}, categoryAppearance: {}, tabOrder: [...DEFAULT_TAB_ORDER], dashboardOrder: [...DEFAULT_DASHBOARD_ORDER], dashboardSizes: structuredClone(DEFAULT_DASHBOARD_SIZES), boxSizes: {}, boxOrder: {} },
      categories: {
        income: ["Paycheck", "Side income"],
        expense: ["Housing", "Utilities", "Groceries", "Transportation", "Insurance", "Dining", "Entertainment", "Personal", "Other"],
        debt: ["Credit card", "Car loan"],
        savings: ["Emergency fund", "Vacation"]
      },
      monthly: Array.from({ length: 12 }, freshMonth),
      recurring: [],
      creditCards: [],
      zipPurchases: []
    };
  }

  function normalizeData(candidate) {
    const base = defaultData();
    const data = candidate && typeof candidate === "object" ? candidate : base;
    const previousDesignVersion = Number(data.settings && data.settings.designVersion) || 0;
    data.version = 2;
    data.settings = { ...base.settings, ...(data.settings || {}) };
    if (previousDesignVersion < 2) {
      data.settings.visualTheme = "midnight";
      data.settings.accentColor = "#63b3ff";
      data.settings.cornerStyle = "rounded";
      data.settings.categoryStyle = "pills";
      data.settings.designVersion = 2;
    }
    const savedTabOrder = Array.isArray(data.settings.tabOrder) ? data.settings.tabOrder : [];
    data.settings.tabOrder = [...new Set(savedTabOrder.filter(tab => DEFAULT_TAB_ORDER.includes(tab)))];
    DEFAULT_TAB_ORDER.forEach(tab => { if (!data.settings.tabOrder.includes(tab)) data.settings.tabOrder.push(tab); });
    const savedDashboardOrder = Array.isArray(data.settings.dashboardOrder) ? data.settings.dashboardOrder : [];
    data.settings.dashboardOrder = [...new Set(savedDashboardOrder.filter(widget => DEFAULT_DASHBOARD_ORDER.includes(widget)))];
    DEFAULT_DASHBOARD_ORDER.forEach(widget => { if (!data.settings.dashboardOrder.includes(widget)) data.settings.dashboardOrder.push(widget); });
    const savedSizes = data.settings.dashboardSizes && typeof data.settings.dashboardSizes === "object" ? data.settings.dashboardSizes : {};
    data.settings.dashboardSizes = {};
    DEFAULT_DASHBOARD_ORDER.forEach(widget => {
      const candidate = savedSizes[widget] || {};
      data.settings.dashboardSizes[widget] = {
        width: ["quarter","small","third","half","twothirds","wide","full"].includes(candidate.width) ? candidate.width : DEFAULT_DASHBOARD_SIZES[widget].width,
        height: ["xcompact","compact","normal","tall","xlarge"].includes(candidate.height) ? candidate.height : DEFAULT_DASHBOARD_SIZES[widget].height,
        font: ["small","standard","large","xlarge"].includes(candidate.font) ? candidate.font : "standard"
      };
    });
    if (!["small","standard","large","xlarge"].includes(data.settings.fontSize)) data.settings.fontSize = "standard";
    if (!["classic","midnight","black"].includes(data.settings.visualTheme)) data.settings.visualTheme = "classic";
    if (!/^#[0-9a-f]{6}$/i.test(String(data.settings.accentColor || ""))) data.settings.accentColor = "#79e7bc";
    if (!["rounded","soft","square"].includes(data.settings.cornerStyle)) data.settings.cornerStyle = "rounded";
    if (!["comfortable","compact"].includes(data.settings.density)) data.settings.density = "comfortable";
    if (!["pills","simple"].includes(data.settings.categoryStyle)) data.settings.categoryStyle = "pills";
    if (!data.settings.categoryAppearance || typeof data.settings.categoryAppearance !== "object" || Array.isArray(data.settings.categoryAppearance)) data.settings.categoryAppearance = {};
    if (!data.settings.boxSizes || typeof data.settings.boxSizes !== "object" || Array.isArray(data.settings.boxSizes)) data.settings.boxSizes = {};
    if (!data.settings.boxOrder || typeof data.settings.boxOrder !== "object" || Array.isArray(data.settings.boxOrder)) data.settings.boxOrder = {};
    data.settings.sidebarCollapsed = Boolean(data.settings.sidebarCollapsed);
    if (!Array.isArray(data.settings.hiddenDashboardWidgets)) data.settings.hiddenDashboardWidgets = [];
    data.settings.hiddenDashboardWidgets = [...new Set(data.settings.hiddenDashboardWidgets.filter(id => DEFAULT_DASHBOARD_ORDER.includes(id)))];
    if (!data.settings.hiddenBoxes || typeof data.settings.hiddenBoxes !== "object" || Array.isArray(data.settings.hiddenBoxes)) data.settings.hiddenBoxes = {};
    data.categories = { ...base.categories, ...(data.categories || {}) };
    for (const type of ["income", "expense", "debt", "savings"]) {
      if (!Array.isArray(data.categories[type])) data.categories[type] = [...base.categories[type]];
      data.categories[type] = [...new Set(data.categories[type].map(String).map(x => x.trim()).filter(Boolean))];
    }
    if (!Array.isArray(data.monthly)) data.monthly = [];
    data.monthly = Array.from({ length: 12 }, (_, index) => {
      const existing = data.monthly[index] || {};
      return {
        ...freshMonth(),
        ...existing,
        income: existing.income || {},
        incomeEntries: Array.isArray(existing.incomeEntries) ? existing.incomeEntries : [],
        budgets: existing.budgets || {},
        weeklyBudgets: Array.from({ length: 5 }, (_, week) => existing.weeklyBudgets && existing.weeklyBudgets[week] ? existing.weeklyBudgets[week] : {}),
        debt: existing.debt || {},
        savings: existing.savings || {},
        transactions: Array.isArray(existing.transactions) ? existing.transactions : [],
        todos: Array.isArray(existing.todos) ? existing.todos : []
      };
    });
    data.recurring = Array.isArray(data.recurring) ? data.recurring : [];
    data.recurring.forEach(item => {
      item.paid = item.paid || {};
      item.icon = String(item.icon || "").slice(0, 12);
      if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(String(item.image || ""))) item.image = "";
    });
    data.creditCards = Array.isArray(data.creditCards) ? data.creditCards : [];
    data.creditCards.forEach(card => {
      card.id = String(card.id || makeId());
      card.name = String(card.name || "Credit card");
      card.issuer = String(card.issuer || "");
      card.lastFour = String(card.lastFour || "").replace(/\D/g, "").slice(-4);
      card.balance = Math.max(0, number(card.balance));
      card.startingBalance = Math.max(card.balance, number(card.startingBalance) || card.balance);
      card.limit = Math.max(0, number(card.limit));
      card.apr = Math.max(0, number(card.apr));
      card.minimumPayment = Math.max(0, number(card.minimumPayment));
      card.dueDay = Math.min(31, Math.max(1, number(card.dueDay) || 1));
      card.color = /^#[0-9a-f]{6}$/i.test(String(card.color || "")) ? card.color : "#63b3ff";
      card.payments = Array.isArray(card.payments) ? card.payments : [];
    });
    data.zipPurchases = Array.isArray(data.zipPurchases) ? data.zipPurchases : [];
    data.zipPurchases.forEach(purchase => {
      purchase.payments = Array.isArray(purchase.payments) ? purchase.payments : [];
      purchase.payments.forEach(payment => { payment.paid = Boolean(payment.paid); });
    });
    return data;
  }

  function loadData() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      return normalizeData(saved ? JSON.parse(saved) : null);
    } catch (error) {
      console.warn("Could not read saved budget", error);
      return defaultData();
    }
  }

  let data = loadData();
  const today = new Date();
  const state = {
    view: "dashboard",
    month: data.settings.year === today.getFullYear() ? today.getMonth() : 0,
    week: Math.min(4, Math.floor((today.getDate() - 1) / 7)),
    transactionMonth: "all",
    transactionCategory: "all",
    calendarMonth: data.settings.year === today.getFullYear() ? today.getMonth() : 0,
    recurringMonth: data.settings.year === today.getFullYear() ? today.getMonth() : 0,
    dashboardMonth: data.settings.year === today.getFullYear() ? today.getMonth() : 0,
    dashboardArrange: false
    ,resizeBoxes: false
  };

  function saveData(showConfirmation = false, skipCloud = false) {
    data.meta = { ...(data.meta || {}), localUpdatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!skipCloud && cloudSession && !applyingRemoteCloud) scheduleCloudSync();
    if (showConfirmation) toast("Changes saved");
  }

  function cloudConfigured() {
    return /^https:\/\/.+\.supabase\.co$/i.test(String(CLOUD_CONFIG.url || "")) && String(CLOUD_CONFIG.anonKey || "").length > 40;
  }

  function cloudBudgetUserId() {
    return cloudSession && (cloudSession.budget_user_id || cloudSession.user.id);
  }

  function usingSharedBudget() {
    return Boolean(cloudSession && cloudSession.budget_user_id && cloudSession.budget_user_id !== cloudSession.user.id);
  }

  function loadCloudSession() {
    try { return JSON.parse(localStorage.getItem(CLOUD_SESSION_KEY) || "null"); } catch { return null; }
  }

  function storeCloudSession(session) {
    cloudSession = session;
    if (session) localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(CLOUD_SESSION_KEY);
    if (session) startRealtimeSync();
    else stopRealtimeSync();
  }

  function stopRealtimeSync() {
    if (realtimeClient && realtimeChannel) realtimeClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
    realtimeClient = null;
    realtimeStatus = "offline";
  }

  function applyCloudData(incoming, announce = true, force = false) {
    if (!incoming || typeof incoming !== "object") return false;
    const incomingTime = Date.parse(incoming.meta && incoming.meta.localUpdatedAt || 0);
    const localTime = Date.parse(data.meta && data.meta.localUpdatedAt || 0);
    if (!force && incomingTime && localTime && incomingTime <= localTime) return false;
    localStorage.setItem("truebalance-recovery-backup-v1", JSON.stringify(data));
    applyingRemoteCloud = true;
    data = normalizeData(incoming);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    applyingRemoteCloud = false;
    applyNavOrder();
    render();
    if (announce) toast("Updated from another device");
    return true;
  }

  async function startRealtimeSync() {
    stopRealtimeSync();
    if (!cloudSession || !cloudConfigured() || typeof globalThis.TRUEBALANCE_CREATE_SUPABASE_CLIENT !== "function") return;
    const client = globalThis.TRUEBALANCE_CREATE_SUPABASE_CLIENT(CLOUD_CONFIG.url, CLOUD_CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    realtimeClient = client;
    await client.realtime.setAuth(cloudSession.access_token);
    if (realtimeClient !== client || !cloudSession) return;
    const budgetUserId = cloudBudgetUserId();
    realtimeChannel = client.channel(`truebalance-${budgetUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "budgets", filter: `user_id=eq.${budgetUserId}` }, payload => {
        if (payload.eventType !== "DELETE" && payload.new && payload.new.data) applyCloudData(payload.new.data);
      })
      .subscribe(status => {
        realtimeStatus = status === "SUBSCRIBED" ? "live" : status.toLowerCase();
        const indicator = document.getElementById("cloudRealtimeStatus");
        if (indicator) indicator.textContent = realtimeStatus === "live" ? "Live on this device" : "Connecting…";
      });
  }

  async function cloudRequest(path, options = {}) {
    if (!cloudConfigured()) throw new Error("Cloud sync is not configured yet");
    const headers = { apikey: CLOUD_CONFIG.anonKey, "Content-Type": "application/json", ...(options.headers || {}) };
    if (options.auth !== false && cloudSession && cloudSession.access_token) headers.Authorization = `Bearer ${cloudSession.access_token}`;
    const response = await fetch(`${CLOUD_CONFIG.url}${path}`, { ...options, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(body && (body.msg || body.message || body.error_description || body.error) || `Cloud request failed (${response.status})`);
    return body;
  }

  async function refreshCloudSession() {
    if (!cloudSession || !cloudSession.refresh_token) return false;
    if (cloudSession.expires_at && Date.now() < cloudSession.expires_at * 1000 - 60000) return true;
    try {
      const refreshed = await cloudRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", auth: false, body: JSON.stringify({ refresh_token: cloudSession.refresh_token }) });
      storeCloudSession({ ...cloudSession, ...refreshed });
      return true;
    } catch { storeCloudSession(null); return false; }
  }

  async function uploadCloud(silent = false) {
    if (!cloudSession || cloudBusy) return;
    if (!await refreshCloudSession()) return;
    cloudBusy = true;
    try {
      if (usingSharedBudget()) {
        await cloudRequest(`/rest/v1/budgets?user_id=eq.${encodeURIComponent(cloudBudgetUserId())}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ data }) });
      } else {
        await cloudRequest("/rest/v1/budgets?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: cloudSession.user.id, data }) });
      }
      if (!silent) toast("Budget synced to cloud");
    } catch (error) { if (!silent) toast(error.message); }
    finally { cloudBusy = false; }
  }

  function scheduleCloudSync() {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => uploadCloud(true), 250);
  }

  async function getCloudBudget() {
    if (!cloudSession || !await refreshCloudSession()) throw new Error("Please sign in again");
    const rows = await cloudRequest(`/rest/v1/budgets?user_id=eq.${encodeURIComponent(cloudBudgetUserId())}&select=user_id,data,updated_at,share_code&limit=1`);
    cloudShareCode = rows && rows.length ? String(rows[0].share_code || "") : "";
    return rows && rows.length ? rows[0] : null;
  }

  async function downloadCloud() {
    const row = await getCloudBudget();
    if (!row) return false;
    applyCloudData(row.data, false, true);
    return true;
  }

  function restoreRecoveryCopy() {
    try {
      const recovery = JSON.parse(localStorage.getItem("truebalance-recovery-backup-v1") || "null");
      if (!recovery || !confirm("Restore the last local copy on this device? Review it before pressing Sync now.")) return;
      data = normalizeData(recovery);
      saveData(false, true);
      applyNavOrder();
      render();
      toast("Local recovery copy restored");
    } catch { toast("The recovery copy could not be restored"); }
  }

  async function reconcileCloud() {
    if (!cloudSession || !cloudConfigured()) return;
    if (!cloudSession.budget_user_id) {
      try {
        const memberships = await cloudRequest(`/rest/v1/budget_members?member_id=eq.${encodeURIComponent(cloudSession.user.id)}&select=budget_user_id&limit=1`);
        if (memberships && memberships.length) storeCloudSession({ ...cloudSession, budget_user_id: memberships[0].budget_user_id });
      } catch { /* sharing schema may not be installed yet */ }
    }
    const row = await getCloudBudget();
    if (!row) { await uploadCloud(true); return; }
    const cloudTime = Date.parse(row.data && row.data.meta && row.data.meta.localUpdatedAt || row.updated_at || 0);
    const localTime = Date.parse(data.meta && data.meta.localUpdatedAt || 0);
    if (!localTime || cloudTime >= localTime) applyCloudData(row.data, false, true);
    else toast("This device has newer changes. Tap Sync now to upload them.");
  }

  async function signInCloud(email, password, createAccount) {
    const path = createAccount ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
    const session = await cloudRequest(path, { method: "POST", auth: false, body: JSON.stringify({ email, password }) });
    if (createAccount && !session.access_token) throw new Error("Check your email to confirm your account, then sign in");
    storeCloudSession(session);
    await reconcileCloud();
  }

  function createShareCodeValue() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return [...bytes].map(value => alphabet[value % alphabet.length]).join("");
  }

  async function createCloudShareCode() {
    if (!cloudSession || usingSharedBudget()) throw new Error("Only the budget owner can create a sharing code");
    if (!await getCloudBudget()) await uploadCloud(true);
    const code = createShareCodeValue();
    await cloudRequest(`/rest/v1/budgets?user_id=eq.${encodeURIComponent(cloudSession.user.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ share_code: code }) });
    cloudShareCode = code;
    render();
    return code;
  }

  async function joinCloudBudget(code) {
    if (!cloudSession) throw new Error("Sign in before joining a shared budget");
    const ownerId = await cloudRequest("/rest/v1/rpc/join_shared_budget", { method: "POST", body: JSON.stringify({ p_share_code: String(code || "").trim().toUpperCase() }) });
    if (!ownerId) throw new Error("That sharing code was not found");
    storeCloudSession({ ...cloudSession, budget_user_id: String(ownerId) });
    await downloadCloud();
    startRealtimeSync();
  }

  async function leaveCloudBudget() {
    if (!usingSharedBudget()) return;
    const ownerId = cloudBudgetUserId();
    await cloudRequest(`/rest/v1/budget_members?budget_user_id=eq.${encodeURIComponent(ownerId)}&member_id=eq.${encodeURIComponent(cloudSession.user.id)}`, { method: "DELETE" });
    const session = { ...cloudSession };
    delete session.budget_user_id;
    cloudShareCode = "";
    storeCloudSession(session);
    await reconcileCloud();
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatMoney(value, compact = false) {
    const amount = number(value);
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: data.settings.currency,
        notation: compact && Math.abs(amount) >= 10000 ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: 0
      }).format(amount);
    } catch {
      return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function titleCase(value) {
    return String(value).replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function monthData(index) { return data.monthly[index]; }
  function sumMap(map) { return Object.values(map || {}).reduce((sum, value) => sum + number(value), 0); }

  function recurringPaidForMonth(index, kind) {
    return data.recurring
      .filter(item => (!kind || item.kind === kind) && Boolean(item.paid && item.paid[index]))
      .reduce((sum, item) => sum + number(item.amount), 0);
  }

  function zipPaymentsForMonth(index, paidOnly = false) {
    const year = number(data.settings.year);
    return data.zipPurchases.flatMap(purchase => purchase.payments.map(payment => ({ ...payment, purchase })))
      .filter(entry => {
        const due = new Date(`${entry.dueDate}T12:00:00`);
        return due.getFullYear() === year && due.getMonth() === index && (!paidOnly || entry.paid);
      });
  }

  function zipPaidForMonth(index) {
    return zipPaymentsForMonth(index, true).reduce((sum, entry) => sum + number(entry.amount), 0);
  }

  function creditDebtTotal() {
    return data.creditCards.reduce((sum, card) => sum + number(card.balance), 0);
  }

  function creditDebtPaidTotal() {
    return data.creditCards.reduce((sum, card) => sum + card.payments.reduce((paid, payment) => paid + number(payment.amount), 0), 0);
  }

  function transactionTotal(index, category) {
    return monthData(index).transactions
      .filter(item => !category || item.category === category)
      .reduce((sum, item) => sum + number(item.amount), 0);
  }

  function incomeEntryTotal(index, category) {
    return monthData(index).incomeEntries
      .filter(item => !category || item.category === category)
      .reduce((sum, item) => sum + number(item.amount), 0);
  }

  function weeklyBudgetTotal(index) {
    return monthData(index).weeklyBudgets.reduce((sum, week) => sum + sumMap(week), 0);
  }

  function monthTotals(index) {
    const month = monthData(index);
    const income = sumMap(month.income) + incomeEntryTotal(index);
    const bills = recurringPaidForMonth(index, "bill");
    const subscriptions = recurringPaidForMonth(index, "subscription");
    const transactions = transactionTotal(index);
    const zip = zipPaidForMonth(index);
    return {
      income,
      expenses: transactions + bills + subscriptions + zip,
      budget: sumMap(month.budgets) + weeklyBudgetTotal(index),
      debt: sumMap(month.debt) + creditDebtTotal(),
      savings: sumMap(month.savings),
      bills,
      subscriptions,
      zip,
      transactions
    };
  }

  function firstAndLastNonZero(type) {
    const entered = data.monthly
      .map(month => ({ value: sumMap(month[type]), entered: Object.keys(month[type] || {}).length > 0 }))
      .filter(item => item.entered);
    return entered.length ? [entered[0].value, entered[entered.length - 1].value] : [0, 0];
  }

  function annualTotals() {
    const months = data.monthly.map((_, index) => monthTotals(index));
    const [firstDebt, lastDebt] = firstAndLastNonZero("debt");
    const [firstSavings, lastSavings] = firstAndLastNonZero("savings");
    return {
      months,
      income: months.reduce((sum, month) => sum + month.income, 0),
      expenses: months.reduce((sum, month) => sum + month.expenses, 0),
      budget: months.reduce((sum, month) => sum + month.budget, 0),
      debt: lastDebt + creditDebtTotal(),
      savings: lastSavings,
      debtReduction: firstDebt - lastDebt + creditDebtPaidTotal(),
      savingsIncrease: lastSavings - firstSavings
    };
  }

  function expenseBreakdownForMonth(index) {
    const items = data.categories.expense.map(category => ({ name: category, value: transactionTotal(index, category) }));
    items.push({ name: "Bills", value: recurringPaidForMonth(index, "bill") });
    items.push({ name: "Subscriptions", value: recurringPaidForMonth(index, "subscription") });
    items.push({ name: "ZIP payments", value: zipPaidForMonth(index) });
    return items.filter(item => item.value > 0).sort((a, b) => b.value - a.value);
  }

  function annualExpenseBreakdown() {
    const totals = new Map();
    data.monthly.forEach((month, index) => {
      month.transactions.forEach(item => totals.set(item.category, (totals.get(item.category) || 0) + number(item.amount)));
      const bills = recurringPaidForMonth(index, "bill");
      const subscriptions = recurringPaidForMonth(index, "subscription");
      if (bills) totals.set("Bills", (totals.get("Bills") || 0) + bills);
      if (subscriptions) totals.set("Subscriptions", (totals.get("Subscriptions") || 0) + subscriptions);
      const zip = zipPaidForMonth(index);
      if (zip) totals.set("ZIP payments", (totals.get("ZIP payments") || 0) + zip);
    });
    return [...totals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }

  function categoryAnnualTotals(type) {
    const totals = new Map();
    data.monthly.forEach(month => {
      Object.entries(month[type] || {}).forEach(([name, value]) => totals.set(name, (totals.get(name) || 0) + number(value)));
      if (type === "income") month.incomeEntries.forEach(item => totals.set(item.category, (totals.get(item.category) || 0) + number(item.amount)));
    });
    return [...totals.entries()].map(([name, value]) => ({ name, value })).filter(item => item.value !== 0).sort((a, b) => b.value - a.value);
  }

  function toast(message) {
    const region = document.getElementById("toastRegion");
    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;
    region.appendChild(element);
    setTimeout(() => element.remove(), 2600);
  }

  function statCard(label, value, meta, color = "var(--mint)", deltaClass = "") {
    return `<article class="stat-card" style="--accent:${color}"><label>${escapeHtml(label)}</label><div class="stat-value">${escapeHtml(value)}</div><div class="stat-meta ${deltaClass}">${meta}</div></article>`;
  }

  function monthStrip(selected) {
    return `<div class="month-strip" aria-label="Select month">${SHORT_MONTHS.map((month, index) =>
      `<button class="month-chip ${selected === index ? "active" : ""}" data-select-month="${index}">${month}</button>`
    ).join("")}</div>`;
  }

  function renderLineChart(income, expenses) {
    const width = 760, height = 230, left = 36, right = 12, top = 12, bottom = 28;
    const values = [...income, ...expenses, 1];
    const max = Math.max(...values) * 1.12;
    const x = index => left + (index * (width - left - right) / 11);
    const y = value => top + (height - top - bottom) * (1 - value / max);
    const points = valuesArray => valuesArray.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
    const area = `${left},${height-bottom} ${points(income)} ${x(11)},${height-bottom}`;
    const grid = Array.from({ length: 5 }, (_, index) => {
      const gy = top + index * (height - top - bottom) / 4;
      return `<line class="grid" x1="${left}" y1="${gy}" x2="${width-right}" y2="${gy}"/>`;
    }).join("");
    const labels = SHORT_MONTHS.map((month, index) => `<text x="${x(index)}" y="${height-7}" text-anchor="middle">${month}</text>`).join("");
    const incomeDots = income.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="3.5" fill="#79e7bc"><title>${MONTHS[index]} income: ${escapeHtml(formatMoney(value))}</title></circle>`).join("");
    const expenseDots = expenses.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="3.5" fill="#a99af8"><title>${MONTHS[index]} expenses: ${escapeHtml(formatMoney(value))}</title></circle>`).join("");
    return `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly income and expenses chart">
      <defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79e7bc"/><stop offset="1" stop-color="#79e7bc" stop-opacity="0"/></linearGradient></defs>
      ${grid}<polygon class="area" points="${area}"/><polyline class="income-line" points="${points(income)}"/><polyline class="expense-line" points="${points(expenses)}"/>${incomeDots}${expenseDots}${labels}
    </svg><div class="chart-legend"><span><i class="legend-dot" style="background:var(--mint)"></i>Income</span><span><i class="legend-dot" style="background:var(--violet)"></i>Expenses</span></div>`;
  }

  function renderDonut(items, centerLabel = "SPENT") {
    const clean = items.filter(item => item.value > 0).slice(0, 8);
    const total = clean.reduce((sum, item) => sum + item.value, 0);
    if (!total) return `<div class="empty-state"><div><strong>No spending yet</strong><p>Add transactions or mark recurring payments paid to build this chart.</p></div></div>`;
    let cursor = 0;
    const segments = clean.map((item, index) => {
      const start = cursor;
      cursor += item.value / total * 100;
      return `${COLORS[index % COLORS.length]} ${start}% ${cursor}%`;
    }).join(",");
    const legend = clean.map((item, index) => `<div class="donut-row"><i style="background:${COLORS[index % COLORS.length]}"></i><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(formatMoney(item.value, true))}</strong></div>`).join("");
    return `<div class="donut-layout"><div class="donut" style="background:conic-gradient(${segments})"><div class="donut-center"><strong>${escapeHtml(formatMoney(total, true))}</strong><span>${escapeHtml(centerLabel)}</span></div></div><div class="donut-legend">${legend}</div></div>`;
  }

  function renderBars(items, color = "var(--mint)") {
    const clean = items.filter(item => item.value > 0).slice(0, 10);
    if (!clean.length) return `<div class="empty-state"><div><strong>No values yet</strong><p>Enter amounts to see the category breakdown.</p></div></div>`;
    const max = Math.max(...clean.map(item => item.value), 1);
    return `<div class="bar-list">${clean.map(item => `<div class="bar-row"><span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, item.value / max * 100)}%;background:${color}"></div></div><strong>${escapeHtml(formatMoney(item.value, true))}</strong></div>`).join("")}</div>`;
  }

  function recurringVisual(item, index = 0, className = "recurring-visual") {
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(String(item.image || ""))) {
      return `<span class="${className} has-image"><img src="${escapeHtml(item.image)}" alt="" loading="lazy"></span>`;
    }
    const appearance = categoryAppearance(item.name, index);
    const fallback = appearance.emoji === "•" ? (item.kind === "subscription" ? "🎧" : "🧾") : appearance.emoji;
    return `<span class="${className}">${escapeHtml(item.icon || fallback)}</span>`;
  }

  function renderDashboardRecurring(monthIndex) {
    const items = [...data.recurring].sort((a,b) => number(a.dueDay)-number(b.dueDay));
    const total = items.reduce((sum,item) => sum + number(item.amount),0);
    const paid = items.filter(item => item.paid && item.paid[monthIndex]).reduce((sum,item) => sum + number(item.amount),0);
    const left = Math.max(0,total-paid);
    const progress = total ? Math.min(100,paid/total*100) : 0;
    const itemCards = items.map((item,index) => {
      const appearance = categoryAppearance(item.name,index);
      const checked = Boolean(item.paid && item.paid[monthIndex]);
      return `<label class="dashboard-recurring-item ${checked ? "paid" : ""}" style="--recurring-color:${appearance.color}"><input type="checkbox" data-dashboard-recurring-check="${escapeHtml(item.id)}" data-month="${monthIndex}" ${checked ? "checked" : ""}>${recurringVisual(item,index,"dashboard-recurring-emoji")}<strong>${escapeHtml(item.name)}</strong><small>${formatMoney(item.amount)} · ${number(item.dueDay)}${number(item.dueDay) % 10 === 1 && number(item.dueDay) !== 11 ? "st" : number(item.dueDay) % 10 === 2 && number(item.dueDay) !== 12 ? "nd" : number(item.dueDay) % 10 === 3 && number(item.dueDay) !== 13 ? "rd" : "th"}</small><em>${checked ? "✓" : ""}</em></label>`;
    }).join("");
    return `<div class="dashboard-recurring-body"><div class="dashboard-recurring-summary"><div><strong>${formatMoney(left)}</strong><span>left to pay</span></div><div class="recurring-progress-ring" style="--progress:${progress}%"><i></i></div><div><strong>${formatMoney(paid)}</strong><span>paid so far</span></div></div><div class="dashboard-recurring-label">THIS MONTH</div><div class="dashboard-recurring-grid">${itemCards}<button class="dashboard-recurring-add" data-action="add-recurring" aria-label="Add recurring payment"><span>+</span><small>Add payment</small></button></div>${items.length ? `<div class="dashboard-recurring-footer"><span>${items.filter(item => item.paid && item.paid[monthIndex]).length} of ${items.length} payments complete</span><button class="ghost-button compact" data-view-jump="recurring">View all payments</button></div>` : `<div class="empty-state"><div><strong>No recurring payments yet</strong><p>Add a bill or subscription here and it will connect to every budget total.</p></div></div>`}</div>`;
  }

  function creditUtilization(card) {
    return card.limit ? Math.min(100, number(card.balance) / number(card.limit) * 100) : 0;
  }

  function renderDashboardCreditDebt() {
    const total = creditDebtTotal();
    const paid = creditDebtPaidTotal();
    const limits = data.creditCards.reduce((sum, card) => sum + number(card.limit), 0);
    const utilization = limits ? Math.min(100, total / limits * 100) : 0;
    const cards = data.creditCards.map(card => `<article class="dashboard-debt-item" style="--debt-color:${card.color}"><div class="debt-card-brand"><span>${escapeHtml((card.issuer || card.name).slice(0,2).toUpperCase())}</span><div><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.issuer || "Credit card")}${card.lastFour ? ` · •••• ${escapeHtml(card.lastFour)}` : ""}</small></div></div><b>${formatMoney(card.balance)}</b><div class="debt-progress"><i style="width:${creditUtilization(card)}%"></i></div><footer><small>${card.limit ? `${Math.round(creditUtilization(card))}% utilized` : `${formatMoney(card.minimumPayment)} minimum`}</small><button class="secondary-button compact" data-action="pay-credit-card" data-id="${escapeHtml(card.id)}" ${number(card.balance) <= 0 ? "disabled" : ""}>Pay</button></footer></article>`).join("");
    return `<div class="dashboard-debt-body"><div class="dashboard-recurring-summary debt-summary"><div><strong>${formatMoney(total)}</strong><span>credit debt remaining</span></div><div class="recurring-progress-ring debt-ring" style="--progress:${Math.max(0,100-utilization)}%"><i></i></div><div><strong>${formatMoney(paid)}</strong><span>payments recorded</span></div></div><div class="dashboard-recurring-label">YOUR CREDIT CARDS</div>${data.creditCards.length ? `<div class="dashboard-debt-grid">${cards}</div><div class="dashboard-recurring-footer"><span>${Math.round(utilization)}% total credit utilization</span><button class="ghost-button compact" data-view-jump="debts">Open credit debt tracker</button></div>` : `<div class="empty-state"><div><strong>No credit cards added</strong><p>Add each card once, then record payments to reduce the balances everywhere in TrueBalance.</p><button class="primary-button compact" data-action="add-credit-card">Add credit card</button></div></div>`}</div>`;
  }

  function renderCreditDebts() {
    const total = creditDebtTotal();
    const totalPaid = creditDebtPaidTotal();
    const minimums = data.creditCards.reduce((sum, card) => sum + number(card.minimumPayment), 0);
    const limits = data.creditCards.reduce((sum, card) => sum + number(card.limit), 0);
    const utilization = limits ? total / limits * 100 : 0;
    const cards = data.creditCards.map(card => {
      const paid = card.payments.reduce((sum,payment) => sum + number(payment.amount),0);
      return `<article class="card credit-card-account" style="--debt-color:${card.color}"><div class="credit-card-top"><div class="debt-card-brand"><span>${escapeHtml((card.issuer || card.name).slice(0,2).toUpperCase())}</span><div><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.issuer || "Credit card")}${card.lastFour ? ` · •••• ${escapeHtml(card.lastFour)}` : ""}</small></div></div><div class="section-actions"><button class="ghost-button compact" data-action="edit-credit-card" data-id="${escapeHtml(card.id)}">Edit</button><button class="delete-icon" data-action="delete-credit-card" data-id="${escapeHtml(card.id)}">×</button></div></div><div class="credit-balance"><span>Current balance</span><strong>${formatMoney(card.balance)}</strong></div><div class="debt-progress"><i style="width:${creditUtilization(card)}%"></i></div><div class="credit-card-meta"><div><span>Credit limit</span><strong>${card.limit ? formatMoney(card.limit) : "—"}</strong></div><div><span>APR</span><strong>${card.apr ? `${card.apr.toFixed(2)}%` : "—"}</strong></div><div><span>Minimum</span><strong>${formatMoney(card.minimumPayment)}</strong></div><div><span>Due</span><strong>${card.dueDay}${card.dueDay === 1 ? "st" : card.dueDay === 2 ? "nd" : card.dueDay === 3 ? "rd" : "th"}</strong></div></div><footer><span>${formatMoney(paid)} paid since added</span><button class="primary-button" data-action="pay-credit-card" data-id="${escapeHtml(card.id)}" ${number(card.balance) <= 0 ? "disabled" : ""}>+ Record payment</button></footer></article>`;
    }).join("");
    const history = data.creditCards.flatMap(card => card.payments.map(payment => ({...payment,card}))).sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0,20);
    return `<div class="page-stack"><div class="section-heading"><div><h2>Credit debt payoff</h2><p>Track every credit card and watch balances decrease whenever you record a payment.</p></div><button class="primary-button" data-action="add-credit-card">+ Add credit card</button></div><section class="stats-grid debt-stats">${statCard("Total credit debt",formatMoney(total),`${data.creditCards.length} cards`,"var(--rose)")}${statCard("Total paid",formatMoney(totalPaid),"Recorded payments","var(--mint)")}${statCard("Monthly minimums",formatMoney(minimums),"Across all cards","var(--gold)")}${statCard("Credit utilization",`${Math.round(utilization)}%`,limits ? `${formatMoney(total)} of ${formatMoney(limits)}` : "Add credit limits","var(--blue)")}</section>${data.creditCards.length ? `<section class="credit-card-grid">${cards}</section>` : `<article class="card"><div class="empty-state"><div><strong>Add your first credit card</strong><p>Enter the current balance, APR, credit limit, minimum payment, and due date.</p><button class="primary-button" data-action="add-credit-card">Add credit card</button></div></div></article>`}<article class="card"><div class="card-header"><div><h3>Payment history</h3><p>Every recorded payment that reduced a card balance</p></div></div><div class="data-table-wrap">${history.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Card</th><th>Note</th><th class="numeric">Payment</th></tr></thead><tbody>${history.map(payment => `<tr><td>${escapeHtml(payment.date)}</td><td><strong>${escapeHtml(payment.card.name)}</strong></td><td>${escapeHtml(payment.note || "Payment")}</td><td class="numeric delta-positive">-${formatMoney(payment.amount)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty-state" style="min-height:130px"><div><strong>No payments recorded</strong><p>Your payment history will appear here.</p></div></div>`}</div></article></div>`;
  }

  function renderDashboard() {
    const annual = annualTotals();
    const monthIncome = annual.months.map(month => month.income);
    const monthExpenses = annual.months.map(month => month.expenses);
    const highestIncomeIndex = monthIncome.indexOf(Math.max(...monthIncome));
    const highestExpenseIndex = monthExpenses.indexOf(Math.max(...monthExpenses));
    const net = annual.income - annual.expenses;
    const expenseBreakdown = annualExpenseBreakdown();
    const monthlyExpenseBreakdown = expenseBreakdownForMonth(state.dashboardMonth);
    const incomeBreakdown = categoryAnnualTotals("income");
    const widgetTools = id => state.dashboardArrange ? `<div class="dashboard-widget-tools"><span class="drag-grip" title="Drag to move">☰</span><label>Width<select data-dashboard-size="${id}" data-dimension="width" aria-label="Box width"><option value="quarter">25%</option><option value="small">33%</option><option value="half">50%</option><option value="twothirds">67%</option><option value="wide">75%</option><option value="full">100%</option></select></label><label>Height<select data-dashboard-size="${id}" data-dimension="height" aria-label="Box height"><option value="xcompact">Extra short</option><option value="compact">Short</option><option value="normal">Auto</option><option value="tall">Tall</option><option value="xlarge">Extra tall</option></select></label><label>Text<select data-dashboard-size="${id}" data-dimension="font" aria-label="Box text size"><option value="small">Small</option><option value="standard">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></label><button class="ghost-button compact" data-action="move-dashboard-up" data-widget="${id}" aria-label="Move box up">↑</button><button class="ghost-button compact" data-action="move-dashboard-down" data-widget="${id}" aria-label="Move box down">↓</button><button class="ghost-button compact hide-box-button" data-action="hide-dashboard-widget" data-widget="${id}">Hide</button></div>` : "";
    const widgetShell = (id, content) => {
      const size = data.settings.dashboardSizes[id];
      return `<article class="card dashboard-widget widget-${size.width} height-${size.height} dashboard-font-${size.font} ${state.dashboardArrange ? "arranging" : ""}" data-dashboard-widget="${id}" draggable="${state.dashboardArrange}">${widgetTools(id)}${content}</article>`;
    };
    const widgets = {
      "cashflow": widgetShell("cashflow", `<div class="card-header"><div><h3>Cash flow by month</h3><p>Income compared with actual spending</p></div><span class="status-badge ${net >= 0 ? "paid" : "due"}">${net >= 0 ? "Positive" : "Negative"}</span></div><div class="card-body chart-wrap">${renderLineChart(monthIncome, monthExpenses)}</div>`),
      "annual-spending": widgetShell("annual-spending", `<div class="card-header"><div><h3>Annual spending</h3><p>Actual expenses by category</p></div></div><div class="card-body">${renderDonut(expenseBreakdown)}</div>`),
      "recurring-overview": widgetShell("recurring-overview", `<div class="card-header"><div><h3>Recurring bills & subscriptions</h3><p>Track monthly payments without leaving the Dashboard</p></div><div class="section-actions"><select id="dashboardRecurringMonth" aria-label="Choose recurring-payment month">${MONTHS.map((month,index) => `<option value="${index}" ${index===state.dashboardMonth ? "selected" : ""}>${month}</option>`).join("")}</select><button class="secondary-button compact" data-action="add-recurring">+ Add</button></div></div>${renderDashboardRecurring(state.dashboardMonth)}`),
      "credit-debt-overview": widgetShell("credit-debt-overview", `<div class="card-header"><div><h3>Credit card debts</h3><p>Balances update whenever you record a payment</p></div><button class="secondary-button compact" data-action="add-credit-card">+ Add card</button></div>${renderDashboardCreditDebt()}`),
      "monthly-spending": widgetShell("monthly-spending", `<div class="card-header"><div><h3>Monthly spending</h3><p>Actual expenses by category for ${MONTHS[state.dashboardMonth]}</p></div><select id="dashboardSpendingMonth" aria-label="Choose month for spending wheel">${MONTHS.map((month,index) => `<option value="${index}" ${index===state.dashboardMonth ? "selected" : ""}>${month}</option>`).join("")}</select></div><div class="card-body">${renderDonut(monthlyExpenseBreakdown, `${SHORT_MONTHS[state.dashboardMonth]} SPENT`)}</div>`),
      "income-categories": widgetShell("income-categories", `<div class="card-header"><div><h3>Income categories</h3><p>Where your income came from</p></div></div><div class="card-body">${renderBars(incomeBreakdown)}</div>`),
      "highlights": widgetShell("highlights", `<div class="card-header"><div><h3>Year highlights</h3><p>Quick performance summary</p></div></div><div class="card-body"><div class="recurring-summary"><div class="mini-summary"><label>Highest income month</label><strong>${monthIncome[highestIncomeIndex] ? MONTHS[highestIncomeIndex] : "—"}</strong></div><div class="mini-summary"><label>Highest expense month</label><strong>${monthExpenses[highestExpenseIndex] ? MONTHS[highestExpenseIndex] : "—"}</strong></div><div class="mini-summary"><label>Debt reduction</label><strong class="${annual.debtReduction >= 0 ? "delta-positive" : "delta-negative"}">${formatMoney(annual.debtReduction)}</strong></div></div></div>`)
    };
    const hiddenDashboard = new Set(data.settings.hiddenDashboardWidgets);
    const hiddenDashboardControls = state.dashboardArrange && hiddenDashboard.size ? `<div class="hidden-box-panel"><div><strong>Hidden dashboard boxes</strong><span>Tap a box to show it again.</span></div><div class="hidden-box-list">${[...hiddenDashboard].map(id => `<button class="ghost-button compact" data-action="show-dashboard-widget" data-widget="${id}">+ ${escapeHtml(DASHBOARD_WIDGET_LABELS[id])}</button>`).join("")}</div></div>` : "";
    return `<div class="page-stack">
      <div class="section-heading"><div><h2>${escapeHtml(data.settings.name)}</h2><p>Your ${data.settings.year} plan at a glance. Every figure updates as you enter monthly data.</p></div><div class="section-actions"><button class="ghost-button" data-action="arrange-dashboard">${state.dashboardArrange ? "Done customizing" : "Customize boxes"}</button>${state.dashboardArrange ? `<button class="ghost-button" data-action="reset-dashboard-layout">Reset dashboard</button>` : ""}<button class="ghost-button" data-action="print">Print dashboard</button><button class="secondary-button" data-view-jump="monthly">Open monthly planner</button></div></div>
      <section class="stats-grid">
        ${statCard("Annual income", formatMoney(annual.income), `Average ${formatMoney(annual.income/12, true)} per month`, "var(--mint)")}
        ${statCard("Annual expenses", formatMoney(annual.expenses), `${annual.income ? Math.round(annual.expenses/annual.income*100) : 0}% of income`, "var(--violet)")}
        ${statCard("Planned budget", formatMoney(annual.budget), `${formatMoney(annual.budget/12, true)} monthly average`, "var(--blue)")}
        ${statCard("Net cash flow", formatMoney(net), net >= 0 ? "Income minus expenses" : "Expenses exceed income", net >= 0 ? "var(--gold)" : "var(--rose)", net >= 0 ? "delta-positive" : "delta-negative")}
        ${statCard("Current savings", formatMoney(annual.savings), `${annual.savingsIncrease >= 0 ? "+" : ""}${formatMoney(annual.savingsIncrease)} this year`, "var(--gold)", annual.savingsIncrease >= 0 ? "delta-positive" : "delta-negative")}
      </section>
      ${hiddenDashboardControls}<section class="dashboard-widgets">${data.settings.dashboardOrder.filter(id => !hiddenDashboard.has(id)).map(id => widgets[id]).join("")}</section>
    </div>`;
  }

  function categoryAppearance(category, index = 0) {
    const saved = data.settings.categoryAppearance[category] || {};
    const lookup = String(category).toLowerCase();
    const emojiKey = Object.keys(CATEGORY_EMOJIS).find(key => lookup.includes(key));
    return {
      color: /^#[0-9a-f]{6}$/i.test(String(saved.color || "")) ? saved.color : COLORS[index % COLORS.length],
      emoji: String(saved.emoji || (emojiKey ? CATEGORY_EMOJIS[emojiKey] : "•")).slice(0, 4)
    };
  }

  function categoryLabel(category, index = 0) {
    const appearance = categoryAppearance(category, index);
    if (data.settings.categoryStyle === "simple") return `<span class="category-simple-label"><i style="background:${appearance.color}"></i>${escapeHtml(appearance.emoji)} ${escapeHtml(category)}</span>`;
    return `<span class="budget-category-pill" style="--category-color:${appearance.color}"><i></i><b>${escapeHtml(appearance.emoji)}</b><span>${escapeHtml(category)}</span></span>`;
  }

  function moneyTableRows(type, monthIndex) {
    const month = monthData(monthIndex);
    const categories = data.categories[type];
    const mapName = type === "expense" ? "budgets" : type;
    if (type === "expense") {
      const rows = [...categories, "Bills", "Subscriptions", "ZIP payments"];
      return rows.map((category,index) => {
        const key = category.toUpperCase();
        const spent = key === "BILLS" ? recurringPaidForMonth(monthIndex, "bill") : key === "SUBSCRIPTIONS" ? recurringPaidForMonth(monthIndex, "subscription") : key === "ZIP PAYMENTS" ? zipPaidForMonth(monthIndex) : transactionTotal(monthIndex, category);
        return `<tr><td>${categoryLabel(category,index)}</td><td class="numeric"><input class="table-input" type="number" min="0" step="0.01" value="${number(month.budgets[category]) || ""}" placeholder="0" data-month-map="budgets" data-category="${escapeHtml(category)}"></td><td class="numeric">${escapeHtml(formatMoney(spent))}</td></tr>`;
      }).join("") + (weeklyBudgetTotal(monthIndex) ? `<tr><td>Weekly plans</td><td class="numeric">${escapeHtml(formatMoney(weeklyBudgetTotal(monthIndex)))}</td><td class="numeric">Included above</td></tr>` : "") + `<tr class="total-row"><td>Total</td><td class="numeric">${escapeHtml(formatMoney(monthTotals(monthIndex).budget))}</td><td class="numeric">${escapeHtml(formatMoney(monthTotals(monthIndex).expenses))}</td></tr>`;
    }
    const rows = categories.map(category => `<tr><td>${escapeHtml(category)}</td><td class="numeric"><input class="table-input" type="number" min="0" step="0.01" value="${number(month[mapName][category]) || ""}" placeholder="0" data-month-map="${mapName}" data-category="${escapeHtml(category)}"></td></tr>`).join("");
    if (type === "income") return rows + `<tr><td>Dated weekly paychecks</td><td class="numeric">${escapeHtml(formatMoney(incomeEntryTotal(monthIndex)))}</td></tr><tr class="total-row"><td>Total</td><td class="numeric">${escapeHtml(formatMoney(monthTotals(monthIndex).income))}</td></tr>`;
    if (type === "debt") return rows + `<tr><td>Credit card tracker</td><td class="numeric">${escapeHtml(formatMoney(creditDebtTotal()))}</td></tr><tr class="total-row"><td>Total</td><td class="numeric">${escapeHtml(formatMoney(monthTotals(monthIndex).debt))}</td></tr>`;
    return rows + `<tr class="total-row"><td>Total</td><td class="numeric">${escapeHtml(formatMoney(sumMap(month[mapName])))}</td></tr>`;
  }

  function renderMonthly() {
    const index = state.month;
    const month = monthData(index);
    const totals = monthTotals(index);
    const remaining = totals.income - totals.expenses;
    const recentTransactions = [...month.transactions].sort((a,b) => number(b.day) - number(a.day)).slice(0, 8);
    return `<div class="page-stack">
      ${monthStrip(index)}
      <section class="stats-grid">
        ${statCard("Total income", formatMoney(totals.income), MONTHS[index], "var(--mint)")}
        ${statCard("Total expenses", formatMoney(totals.expenses), "Transactions + paid recurring + ZIP", "var(--violet)")}
        ${statCard("Planned budget", formatMoney(totals.budget), `${formatMoney(Math.max(0, totals.budget - totals.expenses))} unspent`, "var(--blue)")}
        ${statCard("Debt balance", formatMoney(totals.debt), "Current amount", "var(--rose)")}
        ${statCard("Money remaining", formatMoney(remaining), "Income minus expenses", "var(--gold)", remaining >= 0 ? "delta-positive" : "delta-negative")}
      </section>
      <section class="budget-grid">
        <article class="card budget-card accent-income"><div class="card-header"><div><h3>Income</h3><p>Enter income received this month</p></div><strong>${formatMoney(totals.income)}</strong></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Category</th><th class="numeric">Amount</th></tr></thead><tbody>${moneyTableRows("income", index)}</tbody></table></div></article>
        <article class="card budget-card accent-expense"><div class="card-header"><div><h3>Expenses</h3><p>Compare budget against actual spending</p></div><strong>${formatMoney(totals.expenses)}</strong></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Category</th><th class="numeric">Budget</th><th class="numeric">Spent</th></tr></thead><tbody>${moneyTableRows("expense", index)}</tbody></table></div></article>
        <article class="card budget-card accent-debt"><div class="card-header"><div><h3>Debt</h3><p>Enter each current balance</p></div><strong>${formatMoney(totals.debt)}</strong></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Category</th><th class="numeric">Balance</th></tr></thead><tbody>${moneyTableRows("debt", index)}</tbody></table></div></article>
        <article class="card budget-card accent-savings"><div class="card-header"><div><h3>Savings</h3><p>Enter each current balance</p></div><strong>${formatMoney(totals.savings)}</strong></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Category</th><th class="numeric">Balance</th></tr></thead><tbody>${moneyTableRows("savings", index)}</tbody></table></div></article>
      </section>
      <section class="dashboard-grid">
        <article class="card"><div class="card-header"><div><h3>Transaction log</h3><p>${MONTHS[index]} expenses</p></div><button class="primary-button compact" data-action="add-transaction">+ Add transaction</button></div><div class="data-table-wrap">${transactionTable(recentTransactions, index, true)}</div></article>
        <article class="card"><div class="card-header"><div><h3>Spending breakdown</h3><p>Actual totals by category</p></div></div><div class="card-body">${renderDonut(expenseBreakdownForMonth(index), "THIS MONTH")}</div></article>
      </section>
      <section class="notes-grid">
        <article class="card"><div class="card-header"><div><h3>Notes</h3><p>Keep useful details with this month</p></div></div><div class="card-body"><textarea class="notes-area" data-month-notes placeholder="Add notes for ${MONTHS[index]}...">${escapeHtml(month.notes)}</textarea></div></article>
        <article class="card"><div class="card-header"><div><h3>To-do list</h3><p>Small tasks that keep your plan moving</p></div></div><div class="card-body">${renderTodos(index)}</div></article>
      </section>
    </div>`;
  }

  function weekRange(monthIndex, weekIndex) {
    const daysInMonth = new Date(number(data.settings.year), monthIndex + 1, 0).getDate();
    const start = weekIndex * 7 + 1;
    return { start, end: Math.min(start + 6, daysInMonth) };
  }

  function weeklyRecurring(monthIndex, weekIndex, paidOnly = false) {
    const range = weekRange(monthIndex, weekIndex);
    return data.recurring.filter(item => number(item.dueDay) >= range.start && number(item.dueDay) <= range.end && (!paidOnly || item.paid && item.paid[monthIndex]));
  }

  function weeklyZip(monthIndex, weekIndex, paidOnly = false) {
    const range = weekRange(monthIndex, weekIndex);
    return zipPaymentsForMonth(monthIndex, paidOnly).filter(entry => {
      const day = new Date(`${entry.dueDate}T12:00:00`).getDate();
      return day >= range.start && day <= range.end;
    });
  }

  function weeklyTotals(monthIndex, weekIndex) {
    const month = monthData(monthIndex);
    const range = weekRange(monthIndex, weekIndex);
    const income = month.incomeEntries.filter(item => number(item.day) >= range.start && number(item.day) <= range.end).reduce((sum,item) => sum + number(item.amount),0);
    const transactions = month.transactions.filter(item => number(item.day) >= range.start && number(item.day) <= range.end).reduce((sum,item) => sum + number(item.amount),0);
    const recurringPaid = weeklyRecurring(monthIndex, weekIndex, true).reduce((sum,item) => sum + number(item.amount),0);
    const zipPaid = weeklyZip(monthIndex, weekIndex, true).reduce((sum,item) => sum + number(item.amount),0);
    const billsDue = weeklyRecurring(monthIndex, weekIndex).reduce((sum,item) => sum + number(item.amount),0) + weeklyZip(monthIndex, weekIndex).reduce((sum,item) => sum + number(item.amount),0);
    const budget = sumMap(month.weeklyBudgets[weekIndex]);
    return { income, expenses: transactions + recurringPaid + zipPaid, billsDue, budget, remaining: income - transactions - recurringPaid - zipPaid };
  }

  function weeklyCategorySpent(monthIndex, weekIndex, category) {
    const range = weekRange(monthIndex, weekIndex);
    if (category === "Bills" || category === "Subscriptions") {
      const kind = category === "Bills" ? "bill" : "subscription";
      return weeklyRecurring(monthIndex, weekIndex, true).filter(item => item.kind === kind).reduce((sum,item) => sum + number(item.amount),0);
    }
    if (category === "ZIP payments") return weeklyZip(monthIndex, weekIndex, true).reduce((sum,item) => sum + number(item.amount),0);
    return monthData(monthIndex).transactions.filter(item => item.category === category && number(item.day) >= range.start && number(item.day) <= range.end).reduce((sum,item) => sum + number(item.amount),0);
  }

  function weeklyActivity(monthIndex, weekIndex) {
    const range = weekRange(monthIndex, weekIndex);
    const month = monthData(monthIndex);
    const income = month.incomeEntries.filter(item => number(item.day) >= range.start && number(item.day) <= range.end).map(item => ({ ...item, entryType: "income" }));
    const expenses = month.transactions.filter(item => number(item.day) >= range.start && number(item.day) <= range.end).map(item => ({ ...item, entryType: "expense" }));
    const recurring = weeklyRecurring(monthIndex, weekIndex, true).map(item => ({ id: item.id, day: item.dueDay, category: titleCase(item.kind), description: item.name, amount: item.amount, entryType: "recurring" }));
    const zip = weeklyZip(monthIndex, weekIndex, true).map(item => ({ id: item.id, day: new Date(`${item.dueDate}T12:00:00`).getDate(), category: "ZIP", description: item.purchase.name, amount: item.amount, entryType: "zip" }));
    return [...income, ...expenses, ...recurring, ...zip].sort((a,b) => number(b.day) - number(a.day));
  }

  function renderWeeklyActivity(items, monthIndex) {
    if (!items.length) return `<div class="empty-state"><div><strong>No activity this week</strong><p>Add a paycheck or expense to start tracking this week.</p></div></div>`;
    return `<table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="numeric">Amount</th><th></th></tr></thead><tbody>${items.map(item => `<tr><td>${SHORT_MONTHS[monthIndex]} ${number(item.day)}</td><td><span class="status-badge ${item.entryType === "income" ? "paid" : "due"}">${item.entryType === "income" ? "Income" : escapeHtml(item.category)}</span></td><td>${escapeHtml(item.description || item.category || "—")}</td><td class="numeric ${item.entryType === "income" ? "delta-positive" : ""}">${item.entryType === "income" ? "+" : "−"}${escapeHtml(formatMoney(item.amount))}</td><td class="actions">${item.entryType === "income" ? `<button class="delete-icon" data-action="delete-income" data-id="${escapeHtml(item.id)}" data-month="${monthIndex}">×</button>` : item.entryType === "expense" ? `<button class="delete-icon" data-action="delete-transaction" data-id="${escapeHtml(item.id)}" data-month="${monthIndex}">×</button>` : ""}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderWeekly() {
    const monthIndex = state.month;
    const weekIndex = state.week;
    const range = weekRange(monthIndex, weekIndex);
    const totals = weeklyTotals(monthIndex, weekIndex);
    const month = monthData(monthIndex);
    const categories = [...data.categories.expense, "Bills", "Subscriptions", "ZIP payments"];
    const monthSummary = monthTotals(monthIndex);
    const weekTabs = Array.from({ length: 5 }, (_, index) => { const dates = weekRange(monthIndex,index); return `<button class="month-chip ${weekIndex===index ? "active" : ""}" data-select-week="${index}">Week ${index+1} · ${SHORT_MONTHS[monthIndex]} ${dates.start}–${dates.end}</button>`; }).join("");
    const budgetRows = categories.map((category,index) => { const budget = number(month.weeklyBudgets[weekIndex][category]); const spent = weeklyCategorySpent(monthIndex,weekIndex,category); return `<tr><td>${categoryLabel(category,index)}</td><td class="numeric"><input class="table-input" type="number" min="0" step="0.01" value="${budget || ""}" placeholder="0" data-week-budget="${escapeHtml(category)}"></td><td class="numeric">${formatMoney(spent)}</td><td class="numeric ${budget-spent >= 0 ? "delta-positive" : "delta-negative"}">${formatMoney(budget-spent)}</td></tr>`; }).join("");
    const incomeItems = month.incomeEntries.filter(item => number(item.day) >= range.start && number(item.day) <= range.end).sort((a,b)=>number(a.day)-number(b.day));
    return `<div class="page-stack">
      <div class="section-heading"><div><h2>${MONTHS[monthIndex]} weekly plan</h2><p>Each paycheck and expense automatically rolls into ${MONTHS[monthIndex]} and the annual dashboard.</p></div><div class="section-actions"><select id="weeklyMonthSelect">${MONTHS.map((name,index)=>`<option value="${index}" ${index===monthIndex ? "selected" : ""}>${name}</option>`).join("")}</select><button class="primary-button" data-action="add-income">+ Add paycheck</button></div></div>
      <div class="month-strip weekly-strip">${weekTabs}</div>
      <section class="stats-grid">
        ${statCard("Weekly income",formatMoney(totals.income),`${incomeItems.length} ${incomeItems.length===1?"paycheck":"paychecks"} received`,"var(--mint)")}
        ${statCard("Weekly spending",formatMoney(totals.expenses),`${formatMoney(totals.budget-totals.expenses)} against plan`,"var(--violet)")}
        ${statCard("Bills due",formatMoney(totals.billsDue),`${weeklyRecurring(monthIndex,weekIndex).length} scheduled payments`,"var(--blue)")}
        ${statCard("Weekly budget",formatMoney(totals.budget),"Category spending limit","var(--gold)")}
        ${statCard("Money left",formatMoney(totals.remaining),"Weekly income minus spending","var(--mint)",totals.remaining>=0?"delta-positive":"delta-negative")}
      </section>
      <section class="budget-grid">
        <article class="card budget-card accent-income"><div class="card-header"><div><h3>Income this week</h3><p>Dated paychecks and deposits</p></div><button class="secondary-button compact" data-action="add-income">+ Add paycheck</button></div><div class="data-table-wrap">${incomeItems.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Source</th><th class="numeric">Amount</th><th></th></tr></thead><tbody>${incomeItems.map(item=>`<tr><td>${SHORT_MONTHS[monthIndex]} ${item.day}</td><td>${escapeHtml(item.description || item.category)}</td><td class="numeric">${formatMoney(item.amount)}</td><td class="actions"><button class="delete-icon" data-action="delete-income" data-id="${escapeHtml(item.id)}" data-month="${monthIndex}">×</button></td></tr>`).join("")}<tr class="total-row"><td></td><td>Total income</td><td class="numeric">${formatMoney(totals.income)}</td><td></td></tr></tbody></table>` : `<div class="empty-state"><div><strong>No paycheck this week</strong><p>Add as many separate paychecks as you receive.</p><button class="primary-button compact" data-action="add-income">Add paycheck</button></div></div>`}</div></article>
        <article class="card budget-card accent-expense"><div class="card-header"><div><h3>Weekly spending plan</h3><p>Budget compared with actual spending</p></div><button class="secondary-button compact" data-action="add-transaction">+ Expense</button></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Category</th><th class="numeric">Budget</th><th class="numeric">Spent</th><th class="numeric">Left</th></tr></thead><tbody>${budgetRows}<tr class="total-row"><td>Total</td><td class="numeric">${formatMoney(totals.budget)}</td><td class="numeric">${formatMoney(totals.expenses)}</td><td class="numeric">${formatMoney(totals.budget-totals.expenses)}</td></tr></tbody></table></div></article>
      </section>
      <section class="dashboard-grid"><article class="card"><div class="card-header"><div><h3>Week ${weekIndex+1} activity</h3><p>Income and expenses in date order</p></div><div class="section-actions"><button class="secondary-button compact" data-action="add-income">+ Income</button><button class="primary-button compact" data-action="add-transaction">+ Expense</button></div></div><div class="data-table-wrap">${renderWeeklyActivity(weeklyActivity(monthIndex,weekIndex),monthIndex)}</div></article><article class="card"><div class="card-header"><div><h3>Month progress</h3><p>How all weekly entries affect ${MONTHS[monthIndex]}</p></div><span class="status-badge ${monthSummary.income-monthSummary.expenses>=0?"paid":"due"}">${monthSummary.income-monthSummary.expenses>=0?"On track":"Over income"}</span></div><div class="card-body">${renderBars([{name:"Income",value:monthSummary.income},{name:"Spending",value:monthSummary.expenses},{name:"Savings",value:monthSummary.savings}])}<div class="info-callout" style="margin-top:20px">Week ${weekIndex+1} totals are already included in the monthly and annual pages.</div></div></article></section>
    </div>`;
  }

  function transactionTable(transactions, fallbackMonth = null, compact = false) {
    if (!transactions.length) return `<div class="empty-state"><div><strong>No transactions yet</strong><p>Add an expense and it will appear here automatically.</p><button class="primary-button compact" data-action="add-transaction">Add first transaction</button></div></div>`;
    return `<table class="data-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="numeric">Amount</th><th class="actions"></th></tr></thead><tbody>${transactions.map(item => {
      const monthIndex = item.month !== undefined ? number(item.month) : fallbackMonth;
      const date = monthIndex === null ? "—" : `${SHORT_MONTHS[monthIndex]} ${number(item.day)}`;
      const categoryOptions = [...new Set([item.category, ...data.categories.expense].filter(Boolean))];
      return `<tr><td>${date}</td><td><select class="transaction-category-select" data-transaction-category="${escapeHtml(item.id)}" data-month="${monthIndex}" aria-label="Change category for ${escapeHtml(item.description || "transaction")}">${categoryOptions.map(category => `<option value="${escapeHtml(category)}" ${category === item.category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></td><td>${escapeHtml(item.description || "—")}</td><td class="numeric">${escapeHtml(formatMoney(item.amount))}</td><td class="actions"><div class="row-actions"><button class="edit-icon" title="Edit transaction" aria-label="Edit transaction" data-action="edit-transaction" data-id="${escapeHtml(item.id)}" data-month="${monthIndex}">✎</button><button class="delete-icon" title="Delete transaction" aria-label="Delete transaction" data-action="delete-transaction" data-id="${escapeHtml(item.id)}" data-month="${monthIndex}">×</button></div></td></tr>`;
    }).join("")}</tbody></table>`;
  }

  function allTransactions() {
    return data.monthly.flatMap((month, index) => month.transactions.map(item => ({ ...item, month: index })))
      .sort((a,b) => (number(b.month) * 32 + number(b.day)) - (number(a.month) * 32 + number(a.day)));
  }

  function renderTransactions() {
    let items = allTransactions();
    if (state.transactionMonth !== "all") items = items.filter(item => item.month === number(state.transactionMonth));
    if (state.transactionCategory !== "all") items = items.filter(item => item.category === state.transactionCategory);
    const total = items.reduce((sum,item) => sum + number(item.amount),0);
    const avg = items.length ? total / items.length : 0;
    return `<div class="page-stack">
      <div class="section-heading"><div><h2>Expense activity</h2><p>Search the year by month or category and keep every purchase organized.</p></div><div class="section-actions"><button class="ghost-button" data-action="export-csv">Export CSV</button><button class="primary-button" data-action="add-transaction">+ Add transaction</button></div></div>
      <section class="recurring-summary"><div class="mini-summary"><label>Visible transactions</label><strong>${items.length}</strong></div><div class="mini-summary"><label>Total amount</label><strong>${formatMoney(total)}</strong></div><div class="mini-summary"><label>Average transaction</label><strong>${formatMoney(avg)}</strong></div></section>
      <article class="card"><div class="card-header"><div><h3>Transaction log</h3><p>${items.length} matching ${items.length === 1 ? "entry" : "entries"}</p></div><div class="section-actions"><select id="transactionMonthFilter" aria-label="Filter month"><option value="all">All months</option>${MONTHS.map((month,index) => `<option value="${index}" ${String(state.transactionMonth) === String(index) ? "selected" : ""}>${month}</option>`).join("")}</select><select id="transactionCategoryFilter" aria-label="Filter category"><option value="all">All categories</option>${data.categories.expense.map(category => `<option ${state.transactionCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></div></div><div class="data-table-wrap">${transactionTable(items)}</div></article>
    </div>`;
  }

  function annualRecurringTotal(kind) {
    return data.recurring.filter(item => !kind || item.kind === kind).reduce((total,item) => {
      const paidCount = MONTHS.reduce((sum,_,index) => sum + (item.paid && item.paid[index] ? 1 : 0),0);
      return total + number(item.amount) * paidCount;
    },0);
  }

  function recurringTable(kind) {
    const items = data.recurring.filter(item => item.kind === kind);
    if (!items.length) return `<div class="empty-state"><div><strong>No ${kind === "bill" ? "bills" : "subscriptions"} added</strong><p>Add a recurring payment and track it across all twelve months.</p><button class="primary-button compact" data-action="add-recurring" data-kind="${kind}">Add ${kind}</button></div></div>`;
    return `<table class="data-table recurring-table"><thead><tr><th>Image</th><th class="recurring-name">Name</th><th class="numeric">Amount</th><th class="numeric">Due</th>${SHORT_MONTHS.map(month => `<th class="month-check-cell">${month}</th>`).join("")}<th></th></tr></thead><tbody>${items.map((item,itemIndex) => `<tr><td><button class="recurring-icon-button" data-action="edit-recurring" data-id="${escapeHtml(item.id)}" title="Change image for ${escapeHtml(item.name)}">${recurringVisual(item,itemIndex)}</button></td><td><strong>${escapeHtml(item.name)}</strong></td><td class="numeric">${formatMoney(item.amount)}</td><td class="numeric">${number(item.dueDay)}</td>${MONTHS.map((_,index) => `<td class="month-check-cell"><input class="month-check" type="checkbox" aria-label="${escapeHtml(item.name)} paid in ${MONTHS[index]}" data-recurring-check="${escapeHtml(item.id)}" data-month="${index}" ${item.paid && item.paid[index] ? "checked" : ""}></td>`).join("")}<td class="actions"><button class="edit-icon" data-action="edit-recurring" data-id="${escapeHtml(item.id)}" title="Edit">✎</button><button class="delete-icon" data-action="delete-recurring" data-id="${escapeHtml(item.id)}" title="Delete">×</button></td></tr>`).join("")}</tbody></table>`;
  }

  function renderRecurring() {
    const paidTotal = annualRecurringTotal();
    const projected = data.recurring.reduce((sum,item) => sum + number(item.amount) * 12,0);
    const paidCount = data.recurring.reduce((sum,item) => sum + MONTHS.filter((_,index) => item.paid && item.paid[index]).length,0);
    return `<div class="page-stack">
      <div class="section-heading"><div><h2>Recurring payment tracker</h2><p>Enter each payment once, then check it off month by month. Paid items flow into monthly and annual expenses.</p></div><button class="primary-button" data-action="add-recurring">+ Add recurring payment</button></div>
      <article class="card bulk-check-card"><div class="card-body"><div><p class="eyebrow">BULK CHECKOFF</p><h3>Mark every bill & subscription together</h3><p>Select a month, then check or clear all recurring payments for that month.</p></div><div class="section-actions"><select id="recurringBulkMonth" aria-label="Month for bulk payment checkoff">${MONTHS.map((month,index)=>`<option value="${index}" ${index===state.recurringMonth?"selected":""}>${month}</option>`).join("")}</select><button class="primary-button" data-action="check-all-recurring">✓ Check all</button><button class="ghost-button" data-action="clear-all-recurring">Clear all</button></div></div></article>
      <section class="recurring-summary"><div class="mini-summary"><label>Projected annual cost</label><strong>${formatMoney(projected)}</strong></div><div class="mini-summary"><label>Paid this year</label><strong>${formatMoney(paidTotal)}</strong></div><div class="mini-summary"><label>Payments checked</label><strong>${paidCount}</strong></div></section>
      <article class="card"><div class="card-header"><div><h3>Bills</h3><p>Rent, utilities, insurance, and other regular bills</p></div><button class="secondary-button compact" data-action="add-recurring" data-kind="bill">+ Add bill</button></div><div class="data-table-wrap">${recurringTable("bill")}</div></article>
      <article class="card"><div class="card-header"><div><h3>Subscriptions</h3><p>Memberships, streaming, software, and other subscriptions</p></div><button class="secondary-button compact" data-action="add-recurring" data-kind="subscription">+ Add subscription</button></div><div class="data-table-wrap">${recurringTable("subscription")}</div></article>
    </div>`;
  }

  function zipPaymentStatus(payment) {
    if (payment.paid) return "paid";
    return new Date(`${payment.dueDate}T23:59:59`) < new Date() ? "overdue" : "upcoming";
  }

  function renderZipPurchase(purchase) {
    const paid = purchase.payments.filter(payment => payment.paid).reduce((sum,payment) => sum + number(payment.amount),0);
    const remaining = Math.max(0, number(purchase.total) - paid);
    return `<article class="card zip-purchase-card"><div class="card-header"><div><h3>${escapeHtml(purchase.name)}</h3><p>${escapeHtml(purchase.store || "ZIP purchase")} · ${purchase.payments.length} installments</p></div><div class="section-actions"><span class="status-badge ${remaining ? "due" : "paid"}">${remaining ? `${formatMoney(remaining)} left` : "Paid off"}</span><button class="delete-icon" data-action="delete-zip" data-id="${escapeHtml(purchase.id)}" aria-label="Delete ZIP purchase">×</button></div></div><div class="card-body"><div class="zip-progress"><div><span style="width:${number(purchase.total) ? Math.min(100, paid / number(purchase.total) * 100) : 0}%"></span></div><small>${formatMoney(paid)} of ${formatMoney(purchase.total)} paid</small></div><div class="zip-installment-grid">${purchase.payments.map((payment,index) => {
      const status = zipPaymentStatus(payment);
      const due = new Date(`${payment.dueDate}T12:00:00`);
      return `<label class="zip-installment ${status}"><input type="checkbox" data-zip-payment="${escapeHtml(purchase.id)}" data-payment-index="${index}" ${payment.paid ? "checked" : ""}><span><strong>Payment ${index+1}</strong><small>${due.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</small></span><b>${formatMoney(payment.amount)}</b><em>${status}</em></label>`;
    }).join("")}</div></div></article>`;
  }

  function renderZip() {
    const payments = data.zipPurchases.flatMap(purchase => purchase.payments.map(payment => ({...payment,purchase})));
    const outstanding = payments.filter(payment => !payment.paid).reduce((sum,payment) => sum + number(payment.amount),0);
    const paidYear = MONTHS.reduce((sum,_,index) => sum + zipPaidForMonth(index),0);
    const next = payments.filter(payment => !payment.paid).sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
    const overdue = payments.filter(payment => zipPaymentStatus(payment) === "overdue").length;
    return `<div class="page-stack"><div class="section-heading"><div><h2>ZIP payment tracker</h2><p>Track every installment. Checked payments automatically count toward monthly and annual spending.</p></div><button class="primary-button" data-action="add-zip">+ Add ZIP purchase</button></div><section class="stats-grid zip-stats">${statCard("Outstanding",formatMoney(outstanding),`${payments.filter(payment=>!payment.paid).length} payments remaining`,"var(--violet)")}${statCard("Paid this year",formatMoney(paidYear),"Included in spending totals","var(--mint)")}${statCard("Next payment",next ? formatMoney(next.amount) : formatMoney(0),next ? new Date(`${next.dueDate}T12:00:00`).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "Nothing due","var(--blue)")}${statCard("Overdue",String(overdue),overdue ? "Needs attention" : "All caught up","var(--rose)")}</section>${data.zipPurchases.length ? `<section class="zip-purchase-list">${data.zipPurchases.map(renderZipPurchase).join("")}</section>` : `<article class="card"><div class="empty-state"><div><strong>No ZIP purchases yet</strong><p>Add a purchase and TrueBalance will calculate the installment dates and amounts for you.</p><button class="primary-button" data-action="add-zip">Add first ZIP purchase</button></div></div></article>`}</div>`;
  }

  function calendarCells(monthIndex) {
    const year = number(data.settings.year);
    const firstDay = new Date(year, monthIndex, 1).getDay();
    const days = new Date(year, monthIndex + 1, 0).getDate();
    const previousDays = new Date(year, monthIndex, 0).getDate();
    const cells = [];
    for (let index = 0; index < 42; index++) {
      const raw = index - firstDay + 1;
      const outside = raw < 1 || raw > days;
      const day = raw < 1 ? previousDays + raw : raw > days ? raw - days : raw;
      const isToday = !outside && year === today.getFullYear() && monthIndex === today.getMonth() && day === today.getDate();
      const recurringEvents = outside ? [] : data.recurring.filter(item => number(item.dueDay) === day).map(item => ({ name:item.name, amount:item.amount, kind:item.kind, paid:Boolean(item.paid && item.paid[monthIndex]) }));
      const zipEvents = outside ? [] : zipPaymentsForMonth(monthIndex).filter(item => new Date(`${item.dueDate}T12:00:00`).getDate() === day).map(item => ({ name:`ZIP · ${item.purchase.name}`, amount:item.amount, kind:"zip", paid:item.paid }));
      const events = [...recurringEvents, ...zipEvents];
      cells.push(`<div class="calendar-day ${outside ? "outside" : ""} ${isToday ? "today" : ""}"><span class="day-number">${day}</span>${events.slice(0,3).map(item => `<div class="calendar-event ${item.kind} ${item.paid ? "paid" : ""}" title="${escapeHtml(item.name)} · ${escapeHtml(formatMoney(item.amount))}">${escapeHtml(item.name)}</div>`).join("")}${events.length > 3 ? `<div class="calendar-event">+${events.length-3} more</div>` : ""}</div>`);
    }
    return cells.join("");
  }

  function upcomingForMonth(index) {
    const recurring = data.recurring.map(item => ({ day:number(item.dueDay), name:item.name, type:titleCase(item.kind), paid:Boolean(item.paid && item.paid[index]), amount:item.amount }));
    const zip = zipPaymentsForMonth(index).map(item => ({ day:new Date(`${item.dueDate}T12:00:00`).getDate(), name:item.purchase.name, type:"ZIP installment", paid:item.paid, amount:item.amount }));
    const items = [...recurring, ...zip].sort((a,b) => a.day-b.day);
    if (!items.length) return `<div class="empty-state"><div><strong>No payment dates</strong><p>Add a bill or subscription to place it on the calendar.</p></div></div>`;
    return `<div class="upcoming-list">${items.map(item => `<div class="upcoming-row"><span class="due-date">${item.day}</span><div><strong>${escapeHtml(item.name)}</strong><small>${item.type} · ${item.paid ? "Paid" : "Not paid"}</small></div><span>${escapeHtml(formatMoney(item.amount))}</span></div>`).join("")}</div>`;
  }

  function renderCalendar() {
    const index = state.calendarMonth;
    const totalDue = data.recurring.reduce((sum,item) => sum + number(item.amount),0) + zipPaymentsForMonth(index).reduce((sum,item) => sum + number(item.amount),0);
    return `<div class="page-stack">
      <div class="section-heading"><div><h2>Payment calendar</h2><p>See bills, subscriptions, and ZIP installments together in one place.</p></div><div class="section-actions"><select id="calendarMonthSelect">${MONTHS.map((month,i) => `<option value="${i}" ${i===index ? "selected" : ""}>${month}</option>`).join("")}</select><button class="secondary-button" data-action="add-recurring">+ Add payment</button></div></div>
      <section class="calendar-shell">
        <aside class="calendar-side"><article class="card"><div class="card-header"><div><h3>${MONTHS[index]} due</h3><p>${formatMoney(totalDue)} total scheduled</p></div></div><div class="card-body">${upcomingForMonth(index)}</div></article><article class="card"><div class="card-header"><div><h3>Month notes</h3><p>Shared with the monthly page</p></div></div><div class="card-body"><textarea class="notes-area" data-calendar-notes placeholder="Add notes...">${escapeHtml(monthData(index).notes)}</textarea></div></article></aside>
        <article class="card"><div class="card-body"><div class="calendar-heading"><div><p class="eyebrow">${data.settings.year}</p><h2>${MONTHS[index]}</h2></div><span class="status-badge paid">${data.recurring.length + zipPaymentsForMonth(index).length} payments</span></div><div class="calendar-grid">${["SUN","MON","TUE","WED","THU","FRI","SAT"].map(day => `<div class="weekday">${day}</div>`).join("")}${calendarCells(index)}</div></div></article>
      </section>
      <article class="card"><div class="card-header"><div><h3>${MONTHS[index]} to-do list</h3><p>Tasks are shared with the monthly planner</p></div></div><div class="card-body">${renderTodos(index)}</div></article>
    </div>`;
  }

  function renderTodos(monthIndex) {
    const todos = monthData(monthIndex).todos;
    return `<div class="todo-list">${todos.length ? todos.map(todo => `<div class="todo-row ${todo.done ? "done" : ""}"><input type="checkbox" data-toggle-todo="${escapeHtml(todo.id)}" ${todo.done ? "checked" : ""}><span>${escapeHtml(todo.text)}</span><button class="delete-icon" data-action="delete-todo" data-id="${escapeHtml(todo.id)}">×</button></div>`).join("") : `<div class="empty-state" style="min-height:80px;padding:10px"><div><strong>No tasks yet</strong><p>Add something you want to remember.</p></div></div>`}</div><form class="todo-add" data-todo-form><input name="todo" maxlength="100" placeholder="Add a new task..." required><button class="secondary-button compact">Add</button></form>`;
  }

  function renderCategoryCard(type, description, color) {
    const categories = data.categories[type];
    return `<article class="card category-card" style="border-top:2px solid ${color}"><div class="card-header"><div><h3>${titleCase(type)}</h3><p>${escapeHtml(description)}</p></div><span class="status-badge paid">${categories.length} items</span></div><div class="card-body"><div class="category-list">${categories.map((category,index) => { const appearance = categoryAppearance(category,index); return `<div class="category-row"><i class="category-swatch" style="background:${appearance.color}"></i><span class="category-row-name">${escapeHtml(category)}</span>${type === "expense" ? `<label class="category-style-control" title="Category emoji"><input type="text" maxlength="4" value="${escapeHtml(appearance.emoji)}" data-category-emoji="${escapeHtml(category)}" aria-label="Emoji for ${escapeHtml(category)}"></label><label class="category-color-control" title="Category color"><input type="color" value="${appearance.color}" data-category-color="${escapeHtml(category)}" aria-label="Color for ${escapeHtml(category)}"></label>` : ""}<button class="delete-icon" data-action="delete-category" data-type="${type}" data-category="${escapeHtml(category)}" title="Delete category">×</button></div>`; }).join("")}</div><form class="category-add" data-category-form="${type}"><input name="category" maxlength="40" placeholder="New ${type} category" required><button class="secondary-button compact">Add</button></form></div></article>`;
  }

  function renderCategories() {
    return `<div class="page-stack"><div class="section-heading"><div><h2>Customize your categories</h2><p>Choose expense emojis and colors to create the visual budget style you want.</p></div></div><section class="category-grid">${renderCategoryCard("income","Pay sources and other money received","var(--mint)")}${renderCategoryCard("expense","Flexible spending categories","var(--violet)")}${renderCategoryCard("debt","Balances you want to reduce","var(--blue)")}${renderCategoryCard("savings","Goals and savings accounts","var(--gold)")}</section></div>`;
  }

  function renderSettings() {
    const cloudReady = cloudConfigured();
    const cloudEmail = cloudSession && cloudSession.user ? cloudSession.user.email : "";
    const hasRecoveryCopy = Boolean(localStorage.getItem("truebalance-recovery-backup-v1"));
    const shareCard = `<article class="card share-card"><div class="card-header"><div><h3>Share account</h3><p>Give another member full access to this budget</p></div><span class="status-badge ${usingSharedBudget() ? "paid" : "due"}">${usingSharedBudget() ? "Shared member" : "Owner"}</span></div><div class="card-body">${!cloudSession ? `<div class="info-callout">Connect Cloud Sync first. Every member uses their own email and password.</div>` : usingSharedBudget() ? `<div class="cloud-account"><div><span>Current budget</span><strong>Shared household budget</strong><small class="settings-hint">You have full editing access and your changes sync to every member.</small></div><button class="ghost-button" data-action="leave-shared-budget">Leave shared budget</button></div>` : `<div class="cloud-account"><div><span>Your private sharing code</span>${cloudShareCode ? `<div class="share-code-row"><strong class="share-code">${escapeHtml(cloudShareCode)}</strong><button class="secondary-button compact" data-action="copy-share-code">Copy</button><button class="ghost-button compact" data-action="create-share-code">New code</button></div><small class="settings-hint">Send this code only to the person you trust. A new code disables the previous invitation.</small>` : `<button class="secondary-button" data-action="create-share-code">Create sharing code</button>`}</div><div class="share-divider"><span>OR JOIN ANOTHER BUDGET</span></div><form id="joinBudgetForm" class="form-grid"><div class="field span-2"><label for="shareCodeInput">Invitation code</label><input id="shareCodeInput" name="shareCode" maxlength="20" autocomplete="off" placeholder="Enter the member code" required></div><div class="field span-2"><button class="primary-button">Join shared budget</button></div></form></div>`}</div></article>`;
    const appearanceCard = `<article class="card appearance-card"><div class="card-header"><div><h3>Theme & appearance</h3><p>Make TrueBalance match your style</p></div><span class="status-badge paid">Custom</span></div><form class="card-body form-grid" id="appearanceForm"><div class="field span-2"><label for="visualThemeSelect">Visual style</label><select id="visualThemeSelect" name="visualTheme"><option value="classic" ${data.settings.visualTheme === "classic" ? "selected" : ""}>TrueBalance Classic</option><option value="midnight" ${data.settings.visualTheme === "midnight" ? "selected" : ""}>Midnight Blue — reference style</option><option value="black" ${data.settings.visualTheme === "black" ? "selected" : ""}>Deep Black</option></select></div><div class="theme-preview span-2"><i class="theme-sample classic"></i><i class="theme-sample midnight"></i><i class="theme-sample black"></i></div><div class="field"><label for="accentColorInput">Accent color</label><input id="accentColorInput" name="accentColor" type="color" value="${escapeHtml(data.settings.accentColor)}"></div><div class="field"><label for="cornerStyleSelect">Card corners</label><select id="cornerStyleSelect" name="cornerStyle"><option value="rounded" ${data.settings.cornerStyle === "rounded" ? "selected" : ""}>Extra rounded</option><option value="soft" ${data.settings.cornerStyle === "soft" ? "selected" : ""}>Soft</option><option value="square" ${data.settings.cornerStyle === "square" ? "selected" : ""}>Square</option></select></div><div class="field"><label for="densitySelect">Spacing</label><select id="densitySelect" name="density"><option value="comfortable" ${data.settings.density === "comfortable" ? "selected" : ""}>Comfortable</option><option value="compact" ${data.settings.density === "compact" ? "selected" : ""}>Compact</option></select></div><div class="field"><label for="categoryStyleSelect">Category labels</label><select id="categoryStyleSelect" name="categoryStyle"><option value="pills" ${data.settings.categoryStyle === "pills" ? "selected" : ""}>Color pills + emoji</option><option value="simple" ${data.settings.categoryStyle === "simple" ? "selected" : ""}>Simple text</option></select></div><div class="field span-2"><button class="primary-button">Apply appearance</button></div></form></article>`;
    return `<div class="page-stack">
      <div class="section-heading"><div><h2>Planner settings</h2><p>Choose your year and currency, then back up or move your budget whenever you want.</p></div></div>
      <section class="settings-grid">
        <article class="card"><div class="card-header"><div><h3>General</h3><p>Used across the entire planner</p></div></div><form class="card-body form-grid" id="settingsForm"><div class="field span-2"><label for="budgetName">Budget name</label><input id="budgetName" name="name" value="${escapeHtml(data.settings.name)}" maxlength="60"></div><div class="field"><label for="planYear">Plan year</label><input id="planYear" name="year" type="number" min="2000" max="2100" value="${number(data.settings.year)}"></div><div class="field"><label for="currencySelect">Currency</label><select id="currencySelect" name="currency">${["USD","CAD","EUR","GBP","AUD","MXN","JPY","INR"].map(code => `<option ${data.settings.currency===code ? "selected" : ""}>${code}</option>`).join("")}</select></div><div class="field span-2"><label for="fontSizeSelect">App font size</label><select id="fontSizeSelect" name="fontSize">${[["small","Small"],["standard","Standard"],["large","Large"],["xlarge","Extra large"]].map(([value,label]) => `<option value="${value}" ${data.settings.fontSize===value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field span-2"><button class="primary-button">Save settings</button></div></form></article>
        ${appearanceCard}
        <article class="card"><div class="card-header"><div><h3>Backup & restore</h3><p>Keep a portable copy of your planner</p></div></div><div class="card-body page-stack" style="gap:14px"><div class="info-callout">TrueBalance always keeps a local device copy. Export a backup before clearing browser data or replacing a device.</div><div class="settings-actions"><button class="secondary-button" data-action="export-json">Export backup</button><button class="ghost-button" data-action="import-json">Import backup</button><button class="ghost-button" data-action="export-csv">Export transactions CSV</button></div></div></article>
        <article class="card cloud-card"><div class="card-header"><div><h3>Cloud sync</h3><p>Use the same budget on all your devices</p></div><span class="status-badge ${cloudSession ? "paid" : "due"}">${cloudSession ? "Connected" : "Not connected"}</span></div><div class="card-body">${!cloudReady ? `<div class="info-callout">Cloud sync is ready to connect, but your Supabase project details still need to be added to <strong>config.js</strong>. Follow SUPABASE-SETUP.md.</div>` : cloudSession ? `<div class="cloud-account"><div><span>Signed in as</span><strong>${escapeHtml(cloudEmail)}</strong><small id="cloudRealtimeStatus" class="cloud-live-status">${realtimeStatus === "live" ? "Live on this device" : "Connecting…"}</small></div><div class="info-callout">Live sync sends saved changes to your other open devices automatically. Downloading a cloud copy first creates a recovery copy on this device.</div><div class="settings-actions"><button class="secondary-button" data-action="sync-cloud">Sync now</button><button class="ghost-button" data-action="download-cloud">Download cloud copy</button>${hasRecoveryCopy ? `<button class="ghost-button" data-action="restore-recovery">Restore last local copy</button>` : ""}<button class="ghost-button" data-action="sign-out-cloud">Sign out</button></div></div>` : `<form id="cloudAuthForm" class="form-grid"><div class="field span-2"><label for="cloudEmail">Email</label><input id="cloudEmail" name="email" type="email" autocomplete="email" required></div><div class="field span-2"><label for="cloudPassword">Password</label><input id="cloudPassword" name="password" type="password" minlength="6" autocomplete="current-password" required></div><div class="field span-2 settings-actions"><button class="primary-button" name="mode" value="signin">Sign in</button><button class="secondary-button" name="mode" value="signup">Create account</button></div></form>`}</div></article>
        ${shareCard}
        <article class="card"><div class="card-header"><div><h3>Tab order</h3><p>Arrange the sidebar to fit your routine</p></div></div><div class="card-body"><div class="tab-order-list">${data.settings.tabOrder.map((tab,index) => `<div class="tab-order-row"><span class="tab-order-grip" aria-hidden="true">☰</span><span>${escapeHtml(VIEW_META[tab][1])}</span><div class="tab-order-actions"><button class="ghost-button compact" data-action="move-tab-up" data-tab="${tab}" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(VIEW_META[tab][1])} up">↑</button><button class="ghost-button compact" data-action="move-tab-down" data-tab="${tab}" ${index === data.settings.tabOrder.length-1 ? "disabled" : ""} aria-label="Move ${escapeHtml(VIEW_META[tab][1])} down">↓</button></div></div>`).join("")}</div><p class="settings-hint">On a computer, you can also drag tabs directly in the sidebar. Your order saves automatically.</p></div></article>
        <article class="card"><div class="card-header"><div><h3>Print</h3><p>Create a paper or PDF copy</p></div></div><div class="card-body"><p style="color:var(--muted);font-size:10px;line-height:1.6">Open the Annual Dashboard first, then use the print button to save a clean annual summary as a PDF.</p><button class="secondary-button" data-view-jump="dashboard">Open dashboard</button></div></article>
        <article class="card" style="border-color:rgba(255,112,133,.18)"><div class="card-header"><div><h3>Start over</h3><p>Permanently clear the planner in this browser</p></div></div><div class="card-body"><p style="color:var(--muted);font-size:10px;line-height:1.6">Export a backup first if you may need this information again.</p><button class="danger-button" data-action="reset-data">Reset all data</button></div></article>
      </section>
    </div>`;
  }

  function setView(view) {
    if (!VIEW_META[view]) return;
    state.view = view;
    document.querySelectorAll(".nav-item[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
    const [eyebrow, title] = VIEW_META[view];
    pageEyebrow.textContent = eyebrow;
    pageTitle.textContent = title;
    headerYear.textContent = data.settings.year;
    closeMobileMenu();
    render();
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyNavOrder() {
    const nav = document.querySelector(".main-nav");
    if (!nav) return;
    data.settings.tabOrder.forEach(tab => {
      const button = nav.querySelector(`[data-view="${tab}"]`);
      if (button) nav.appendChild(button);
    });
  }

  function moveTab(tab, offset) {
    const current = data.settings.tabOrder.indexOf(tab);
    const next = current + offset;
    if (current < 0 || next < 0 || next >= data.settings.tabOrder.length) return;
    [data.settings.tabOrder[current], data.settings.tabOrder[next]] = [data.settings.tabOrder[next], data.settings.tabOrder[current]];
    saveData();
    applyNavOrder();
    render();
    toast("Tab order saved");
  }

  function prepareResizableBoxes() {
    app.classList.toggle("resize-boxes-mode", state.resizeBoxes);
    const cards = [...app.querySelectorAll("article.card:not(.dashboard-widget)")];
    const titleCounts = {};
    const boxLabels = {};
    const hiddenKeys = new Set(Array.isArray(data.settings.hiddenBoxes[state.view]) ? data.settings.hiddenBoxes[state.view] : []);
    cards.forEach((card, index) => {
      const heading = card.querySelector("h3")?.textContent.trim() || `Box ${index + 1}`;
      const baseTitle = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `box-${index + 1}`;
      titleCounts[baseTitle] = (titleCounts[baseTitle] || 0) + 1;
      const title = titleCounts[baseTitle] > 1 ? `${baseTitle}-${titleCounts[baseTitle]}` : baseTitle;
      const key = `${state.view}:${title}`;
      boxLabels[key] = heading;
      const saved = { width: "standard", height: "normal", font: "standard", ...(data.settings.boxSizes[key] || {}) };
      card.dataset.boxSizeKey = key;
      card.hidden = hiddenKeys.has(key);
      card.classList.add(`global-width-${saved.width || "standard"}`, `global-height-${saved.height || "normal"}`, `global-font-${saved.font || "standard"}`);
    });
    const savedOrder = Array.isArray(data.settings.boxOrder[state.view]) ? data.settings.boxOrder[state.view] : [];
    [...new Set(cards.map(card => card.parentElement))].forEach(parent => {
      const siblings = cards.filter(card => card.parentElement === parent);
      siblings.sort((a,b) => {
        const ai = savedOrder.indexOf(a.dataset.boxSizeKey), bi = savedOrder.indexOf(b.dataset.boxSizeKey);
        return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
      }).forEach(card => parent.appendChild(card));
    });
    if (state.resizeBoxes && state.view !== "dashboard") app.insertAdjacentHTML("afterbegin", `<div class="layout-customize-banner"><div><strong>Customize ${escapeHtml(VIEW_META[state.view][1])}</strong><span>Resize, move, hide, or restore boxes. Hidden boxes keep all their data.</span>${hiddenKeys.size ? `<div class="hidden-box-list">${[...hiddenKeys].map(key => `<button class="ghost-button compact" data-show-global-box="${escapeHtml(key)}">+ ${escapeHtml(boxLabels[key] || key.split(":").pop().replace(/-/g," "))}</button>`).join("")}</div>` : ""}</div><button class="ghost-button compact" data-reset-page-layout>Reset this tab</button></div>`);
    cards.forEach(card => {
      if (!state.resizeBoxes || card.hidden) return;
      const key = card.dataset.boxSizeKey;
      const saved = { width: "standard", height: "normal", font: "standard", ...(data.settings.boxSizes[key] || {}) };
      card.draggable = true;
      card.insertAdjacentHTML("afterbegin", `<div class="global-box-tools"><span class="global-drag-grip" title="Drag to move">☰</span><label>Width<select data-global-box-size="${escapeHtml(key)}" data-dimension="width"><option value="standard">Standard</option><option value="quarter">25%</option><option value="third">33%</option><option value="half">50%</option><option value="twothirds">67%</option><option value="wide">75%</option><option value="full">100%</option></select></label><label>Height<select data-global-box-size="${escapeHtml(key)}" data-dimension="height"><option value="xcompact">Extra short</option><option value="compact">Short</option><option value="normal">Auto</option><option value="tall">Tall</option><option value="xlarge">Extra tall</option></select></label><label>Text<select data-global-box-size="${escapeHtml(key)}" data-dimension="font"><option value="small">Small</option><option value="standard">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></label><button class="ghost-button compact" type="button" data-move-global-box="${escapeHtml(key)}" data-offset="-1" aria-label="Move box up">↑</button><button class="ghost-button compact" type="button" data-move-global-box="${escapeHtml(key)}" data-offset="1" aria-label="Move box down">↓</button><button class="ghost-button compact" type="button" data-reset-box-size="${escapeHtml(key)}">Reset</button><button class="ghost-button compact hide-box-button" type="button" data-hide-global-box="${escapeHtml(key)}">Hide</button></div>`);
      card.querySelectorAll("[data-global-box-size]").forEach(select => { select.value = saved[select.dataset.dimension]; });
    });
    const toggle = document.getElementById("toggleResizeBoxes");
    if (toggle) { toggle.textContent = state.resizeBoxes ? "Done customizing" : "Customize layout"; toggle.classList.toggle("active", state.resizeBoxes); }
  }

  function saveGlobalBoxOrder() {
    data.settings.boxOrder[state.view] = [...app.querySelectorAll("article.card:not(.dashboard-widget)")].map(card => card.dataset.boxSizeKey);
    saveData();
  }

  function moveGlobalBox(key, offset) {
    const card = [...app.querySelectorAll("[data-box-size-key]")].find(item => item.dataset.boxSizeKey === key);
    if (!card) return;
    const siblings = [...card.parentElement.children].filter(item => item.matches && item.matches("article.card:not(.dashboard-widget)"));
    const index = siblings.indexOf(card), target = siblings[index + offset];
    if (!target) return;
    if (offset < 0) card.parentElement.insertBefore(card, target);
    else card.parentElement.insertBefore(target, card);
    saveGlobalBoxOrder();
    render();
    toast("Box order saved");
  }

  function bindGlobalBoxDragging() {
    let dragged = null;
    app.querySelectorAll("article.card:not(.dashboard-widget)").forEach(card => {
      card.addEventListener("dragstart", event => {
        if (event.target.closest("button,select,input,textarea,label")) { event.preventDefault(); return; }
        dragged = card;
        card.classList.add("dragging");
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); dragged = null; });
      card.addEventListener("dragover", event => {
        if (!dragged || dragged.parentElement !== card.parentElement || dragged === card) return;
        event.preventDefault();
        card.classList.add("drag-over");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", event => {
        event.preventDefault();
        card.classList.remove("drag-over");
        if (!dragged || dragged.parentElement !== card.parentElement || dragged === card) return;
        card.parentElement.insertBefore(dragged, card);
        saveGlobalBoxOrder();
        render();
        toast("Box order saved");
      });
    });
  }

  function render() {
    document.body.dataset.fontSize = data.settings.fontSize;
    document.body.dataset.visualTheme = data.settings.visualTheme;
    document.body.dataset.cornerStyle = data.settings.cornerStyle;
    document.body.dataset.density = data.settings.density;
    document.body.dataset.sidebarCollapsed = String(data.settings.sidebarCollapsed);
    document.documentElement.style.setProperty("--mint", data.settings.accentColor);
    document.documentElement.style.setProperty("--user-accent", data.settings.accentColor);
    const renderers = {
      dashboard: renderDashboard,
      monthly: renderMonthly,
      transactions: renderTransactions,
      recurring: renderRecurring,
      debts: renderCreditDebts,
      zip: renderZip,
      calendar: renderCalendar,
      categories: renderCategories,
      settings: renderSettings
    };
    app.innerHTML = renderers[state.view]();
    prepareResizableBoxes();
    bindViewEvents();
    applySidebarState();
  }

  function bindViewEvents() {
    app.querySelectorAll("[data-view-jump]").forEach(button => button.addEventListener("click", () => setView(button.dataset.viewJump)));
    app.querySelectorAll("[data-select-month]").forEach(button => button.addEventListener("click", () => {
      state.month = number(button.dataset.selectMonth);
      render();
    }));
    app.querySelectorAll("[data-select-week]").forEach(button => button.addEventListener("click", () => {
      state.week = number(button.dataset.selectWeek);
      render();
    }));

    app.querySelectorAll("[data-month-map]").forEach(input => input.addEventListener("change", () => {
      const map = input.dataset.monthMap;
      monthData(state.month)[map][input.dataset.category] = Math.max(0, number(input.value));
      saveData();
      render();
    }));
    app.querySelectorAll("[data-week-budget]").forEach(input => input.addEventListener("change", () => {
      monthData(state.month).weeklyBudgets[state.week][input.dataset.weekBudget] = Math.max(0, number(input.value));
      saveData();
      render();
    }));

    app.querySelectorAll("[data-month-notes]").forEach(input => input.addEventListener("input", () => {
      monthData(state.month).notes = input.value;
      saveData();
    }));
    app.querySelectorAll("[data-calendar-notes]").forEach(input => input.addEventListener("input", () => {
      monthData(state.calendarMonth).notes = input.value;
      saveData();
    }));

    app.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => handleAction(button)));
    app.querySelectorAll("[data-dashboard-size]").forEach(select => {
      const size = data.settings.dashboardSizes[select.dataset.dashboardSize];
      select.value = size[select.dataset.dimension];
      select.addEventListener("change", () => {
        size[select.dataset.dimension] = select.value;
        saveData();
        render();
        toast("Box size saved");
      });
    });
    app.querySelectorAll("[data-global-box-size]").forEach(select => select.addEventListener("change", () => {
      const key = select.dataset.globalBoxSize;
      const saved = { width: "standard", height: "normal", font: "standard", ...(data.settings.boxSizes[key] || {}) };
      saved[select.dataset.dimension] = select.value;
      data.settings.boxSizes[key] = saved;
      saveData();
      render();
      toast("Box size saved");
    }));
    app.querySelectorAll("[data-reset-box-size]").forEach(button => button.addEventListener("click", () => {
      delete data.settings.boxSizes[button.dataset.resetBoxSize];
      saveData();
      render();
      toast("Box size reset");
    }));
    app.querySelectorAll("[data-move-global-box]").forEach(button => button.addEventListener("click", () => moveGlobalBox(button.dataset.moveGlobalBox, number(button.dataset.offset))));
    app.querySelectorAll("[data-hide-global-box]").forEach(button => button.addEventListener("click", () => {
      const hidden = new Set(Array.isArray(data.settings.hiddenBoxes[state.view]) ? data.settings.hiddenBoxes[state.view] : []);
      hidden.add(button.dataset.hideGlobalBox);
      data.settings.hiddenBoxes[state.view] = [...hidden];
      saveData();
      render();
      toast("Box hidden — restore it from Customize layout");
    }));
    app.querySelectorAll("[data-show-global-box]").forEach(button => button.addEventListener("click", () => {
      data.settings.hiddenBoxes[state.view] = (data.settings.hiddenBoxes[state.view] || []).filter(key => key !== button.dataset.showGlobalBox);
      saveData();
      render();
      toast("Box restored");
    }));
    app.querySelectorAll("[data-reset-page-layout]").forEach(button => button.addEventListener("click", () => {
      Object.keys(data.settings.boxSizes).filter(key => key.startsWith(`${state.view}:`)).forEach(key => delete data.settings.boxSizes[key]);
      delete data.settings.boxOrder[state.view];
      delete data.settings.hiddenBoxes[state.view];
      saveData();
      render();
      toast("This tab's layout was reset");
    }));
    if (state.resizeBoxes && state.view !== "dashboard") bindGlobalBoxDragging();
    if (state.dashboardArrange) bindDashboardDragging();
    app.querySelectorAll("[data-transaction-category]").forEach(select => select.addEventListener("change", () => {
      const monthIndex = number(select.dataset.month);
      const transaction = monthData(monthIndex).transactions.find(item => item.id === select.dataset.transactionCategory);
      if (!transaction || !data.categories.expense.includes(select.value)) return;
      transaction.category = select.value;
      saveData();
      render();
      toast(`Category changed to ${select.value}`);
    }));
    app.querySelectorAll("[data-recurring-check]").forEach(input => input.addEventListener("change", () => {
      const item = data.recurring.find(entry => entry.id === input.dataset.recurringCheck);
      if (!item) return;
      item.paid[number(input.dataset.month)] = input.checked;
      saveData();
      toast(`${item.name} marked ${input.checked ? "paid" : "not paid"} for ${MONTHS[number(input.dataset.month)]}`);
      if (state.view !== "recurring") render();
    }));
    app.querySelectorAll("[data-dashboard-recurring-check]").forEach(input => input.addEventListener("change", () => {
      const item = data.recurring.find(entry => entry.id === input.dataset.dashboardRecurringCheck);
      if (!item) return;
      item.paid[number(input.dataset.month)] = input.checked;
      saveData();
      render();
      toast(`${item.name} marked ${input.checked ? "paid" : "not paid"}`);
    }));
    app.querySelectorAll("[data-zip-payment]").forEach(input => input.addEventListener("change", () => {
      const purchase = data.zipPurchases.find(item => item.id === input.dataset.zipPayment);
      const payment = purchase && purchase.payments[number(input.dataset.paymentIndex)];
      if (!payment) return;
      payment.paid = input.checked;
      saveData();
      render();
      toast(`ZIP payment marked ${input.checked ? "paid" : "not paid"}`);
    }));

    app.querySelectorAll("[data-category-form]").forEach(form => form.addEventListener("submit", event => {
      event.preventDefault();
      const type = form.dataset.categoryForm;
      const input = form.elements.category;
      const value = input.value.trim();
      if (!value) return;
      if (data.categories[type].some(category => category.toLowerCase() === value.toLowerCase())) {
        toast("That category already exists");
        return;
      }
      data.categories[type].push(value);
      saveData();
      render();
      toast(`${value} added`);
    }));
    app.querySelectorAll("[data-category-color]").forEach(input => input.addEventListener("change", () => {
      const category = input.dataset.categoryColor;
      data.settings.categoryAppearance[category] = { ...(data.settings.categoryAppearance[category] || {}), color: input.value };
      saveData();
      render();
      toast(`${category} color saved`);
    }));
    app.querySelectorAll("[data-category-emoji]").forEach(input => input.addEventListener("change", () => {
      const category = input.dataset.categoryEmoji;
      data.settings.categoryAppearance[category] = { ...(data.settings.categoryAppearance[category] || {}), emoji: input.value.trim() || "•" };
      saveData();
      render();
      toast(`${category} emoji saved`);
    }));

    app.querySelectorAll("[data-todo-form]").forEach(form => form.addEventListener("submit", event => {
      event.preventDefault();
      const monthIndex = state.view === "calendar" ? state.calendarMonth : state.month;
      const value = form.elements.todo.value.trim();
      if (!value) return;
      monthData(monthIndex).todos.push({ id: makeId(), text: value, done: false });
      saveData();
      render();
    }));
    app.querySelectorAll("[data-toggle-todo]").forEach(input => input.addEventListener("change", () => {
      const monthIndex = state.view === "calendar" ? state.calendarMonth : state.month;
      const todo = monthData(monthIndex).todos.find(entry => entry.id === input.dataset.toggleTodo);
      if (todo) todo.done = input.checked;
      saveData();
      render();
    }));

    const monthFilter = document.getElementById("transactionMonthFilter");
    if (monthFilter) monthFilter.addEventListener("change", () => { state.transactionMonth = monthFilter.value; render(); });
    const categoryFilter = document.getElementById("transactionCategoryFilter");
    if (categoryFilter) categoryFilter.addEventListener("change", () => { state.transactionCategory = categoryFilter.value; render(); });
    const calendarMonthSelect = document.getElementById("calendarMonthSelect");
    if (calendarMonthSelect) calendarMonthSelect.addEventListener("change", () => { state.calendarMonth = number(calendarMonthSelect.value); render(); });
    const weeklyMonthSelect = document.getElementById("weeklyMonthSelect");
    if (weeklyMonthSelect) weeklyMonthSelect.addEventListener("change", () => { state.month = number(weeklyMonthSelect.value); state.week = 0; render(); });
    const recurringBulkMonth = document.getElementById("recurringBulkMonth");
    if (recurringBulkMonth) recurringBulkMonth.addEventListener("change", () => { state.recurringMonth = number(recurringBulkMonth.value); render(); });
    const dashboardSpendingMonth = document.getElementById("dashboardSpendingMonth");
    if (dashboardSpendingMonth) dashboardSpendingMonth.addEventListener("change", () => { state.dashboardMonth = number(dashboardSpendingMonth.value); render(); });
    const dashboardRecurringMonth = document.getElementById("dashboardRecurringMonth");
    if (dashboardRecurringMonth) dashboardRecurringMonth.addEventListener("change", () => { state.dashboardMonth = number(dashboardRecurringMonth.value); render(); });

    const settingsForm = document.getElementById("settingsForm");
    if (settingsForm) settingsForm.addEventListener("submit", event => {
      event.preventDefault();
      const form = new FormData(settingsForm);
      data.settings.name = String(form.get("name") || "My budget").trim() || "My budget";
      data.settings.year = Math.min(2100, Math.max(2000, number(form.get("year"))));
      data.settings.currency = String(form.get("currency") || "USD");
      data.settings.fontSize = String(form.get("fontSize") || "standard");
      saveData();
      headerYear.textContent = data.settings.year;
      render();
      toast("Settings saved");
    });
    const appearanceForm = document.getElementById("appearanceForm");
    if (appearanceForm) appearanceForm.addEventListener("submit", event => {
      event.preventDefault();
      const form = new FormData(appearanceForm);
      data.settings.visualTheme = String(form.get("visualTheme") || "classic");
      data.settings.accentColor = String(form.get("accentColor") || "#79e7bc");
      data.settings.cornerStyle = String(form.get("cornerStyle") || "rounded");
      data.settings.density = String(form.get("density") || "comfortable");
      data.settings.categoryStyle = String(form.get("categoryStyle") || "pills");
      saveData();
      render();
      toast("Appearance updated");
    });
    const cloudAuthForm = document.getElementById("cloudAuthForm");
    if (cloudAuthForm) cloudAuthForm.addEventListener("submit", async event => {
      event.preventDefault();
      const submitter = event.submitter;
      const form = new FormData(cloudAuthForm);
      try {
        await signInCloud(String(form.get("email") || "").trim(), String(form.get("password") || ""), submitter && submitter.value === "signup");
        render();
        toast("Cloud account connected");
      } catch (error) { toast(error.message); }
    });
    const joinBudgetForm = document.getElementById("joinBudgetForm");
    if (joinBudgetForm) joinBudgetForm.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await joinCloudBudget(new FormData(joinBudgetForm).get("shareCode"));
        render();
        toast("Shared budget connected");
      } catch (error) { toast(error.message); }
    });
  }

  function handleAction(button) {
    const action = button.dataset.action;
    if (action === "add-transaction") openTransactionModal(state.view === "monthly" ? state.month : undefined);
    if (action === "edit-transaction") openEditTransactionModal(button.dataset.id, number(button.dataset.month));
    if (action === "add-income") openIncomeModal(state.month);
    if (action === "add-recurring") openRecurringModal(button.dataset.kind);
    if (action === "edit-recurring") openRecurringModal(undefined, button.dataset.id);
    if (action === "add-credit-card") openCreditCardModal();
    if (action === "edit-credit-card") openCreditCardModal(button.dataset.id);
    if (action === "pay-credit-card") openCreditCardPaymentModal(button.dataset.id);
    if (action === "add-zip") openZipModal();
    if (action === "delete-transaction") deleteTransaction(button.dataset.id, number(button.dataset.month));
    if (action === "delete-income") deleteIncome(button.dataset.id, number(button.dataset.month));
    if (action === "delete-recurring") deleteRecurring(button.dataset.id);
    if (action === "delete-credit-card") deleteCreditCard(button.dataset.id);
    if (action === "delete-zip") deleteZipPurchase(button.dataset.id);
    if (action === "delete-category") deleteCategory(button.dataset.type, button.dataset.category);
    if (action === "delete-todo") deleteTodo(button.dataset.id);
    if (action === "export-json") exportJson();
    if (action === "import-json") importInput.click();
    if (action === "export-csv") exportCsv();
    if (action === "reset-data") resetData();
    if (action === "move-tab-up") moveTab(button.dataset.tab, -1);
    if (action === "move-tab-down") moveTab(button.dataset.tab, 1);
    if (action === "sync-cloud") uploadCloud();
    if (action === "download-cloud") downloadCloud().then(found => toast(found ? "Cloud budget downloaded" : "No cloud budget found")).catch(error => toast(error.message));
    if (action === "restore-recovery") restoreRecoveryCopy();
    if (action === "create-share-code") createCloudShareCode().then(code => toast(`Sharing code ${code} is ready`)).catch(error => toast(error.message));
    if (action === "copy-share-code") navigator.clipboard.writeText(cloudShareCode).then(() => toast("Sharing code copied")).catch(() => toast("Copy the code shown on screen"));
    if (action === "leave-shared-budget" && confirm("Leave this shared budget and return to your personal budget?")) leaveCloudBudget().then(() => { render(); toast("Shared budget left"); }).catch(error => toast(error.message));
    if (action === "sign-out-cloud") { storeCloudSession(null); render(); toast("Signed out"); }
    if (action === "print") window.print();
    if (action === "check-all-recurring") setAllRecurring(true);
    if (action === "clear-all-recurring") setAllRecurring(false);
    if (action === "arrange-dashboard") { state.dashboardArrange = !state.dashboardArrange; render(); }
    if (action === "hide-dashboard-widget") {
      if (!data.settings.hiddenDashboardWidgets.includes(button.dataset.widget)) data.settings.hiddenDashboardWidgets.push(button.dataset.widget);
      saveData();
      render();
      toast("Dashboard box hidden");
    }
    if (action === "show-dashboard-widget") {
      data.settings.hiddenDashboardWidgets = data.settings.hiddenDashboardWidgets.filter(id => id !== button.dataset.widget);
      saveData();
      render();
      toast("Dashboard box restored");
    }
    if (action === "reset-dashboard-layout") {
      data.settings.dashboardOrder = [...DEFAULT_DASHBOARD_ORDER];
      data.settings.dashboardSizes = structuredClone(DEFAULT_DASHBOARD_SIZES);
      data.settings.hiddenDashboardWidgets = [];
      saveData();
      render();
      toast("Dashboard layout reset");
    }
    if (action === "move-dashboard-up") moveDashboardWidget(button.dataset.widget, -1);
    if (action === "move-dashboard-down") moveDashboardWidget(button.dataset.widget, 1);
  }

  function moveDashboardWidget(widget, offset) {
    const current = data.settings.dashboardOrder.indexOf(widget);
    const next = current + offset;
    if (current < 0 || next < 0 || next >= data.settings.dashboardOrder.length) return;
    [data.settings.dashboardOrder[current], data.settings.dashboardOrder[next]] = [data.settings.dashboardOrder[next], data.settings.dashboardOrder[current]];
    saveData();
    render();
    toast("Dashboard order saved");
  }

  function bindDashboardDragging() {
    let dragged = null;
    app.querySelectorAll("[data-dashboard-widget]").forEach(widget => {
      widget.addEventListener("dragstart", event => {
        if (event.target.closest("button,select,label")) { event.preventDefault(); return; }
        dragged = widget.dataset.dashboardWidget;
        widget.classList.add("dragging");
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      widget.addEventListener("dragend", () => { widget.classList.remove("dragging"); dragged = null; });
      widget.addEventListener("dragover", event => { event.preventDefault(); widget.classList.add("drag-over"); });
      widget.addEventListener("dragleave", () => widget.classList.remove("drag-over"));
      widget.addEventListener("drop", event => {
        event.preventDefault();
        widget.classList.remove("drag-over");
        const target = widget.dataset.dashboardWidget;
        if (!dragged || dragged === target) return;
        const order = data.settings.dashboardOrder.filter(id => id !== dragged);
        order.splice(order.indexOf(target), 0, dragged);
        data.settings.dashboardOrder = order;
        saveData();
        render();
        toast("Dashboard order saved");
      });
    });
  }

  function deleteTransaction(id, monthIndex) {
    const month = monthData(monthIndex);
    const item = month.transactions.find(entry => entry.id === id);
    if (!item || !confirm(`Delete the ${formatMoney(item.amount)} transaction?`)) return;
    month.transactions = month.transactions.filter(entry => entry.id !== id);
    saveData();
    render();
    toast("Transaction deleted");
  }

  function deleteIncome(id, monthIndex) {
    const month = monthData(monthIndex);
    const item = month.incomeEntries.find(entry => entry.id === id);
    if (!item || !confirm(`Delete the ${formatMoney(item.amount)} income entry?`)) return;
    month.incomeEntries = month.incomeEntries.filter(entry => entry.id !== id);
    saveData();
    render();
    toast("Income entry deleted");
  }

  function setAllRecurring(checked) {
    if (!data.recurring.length) { toast("Add a bill or subscription first"); return; }
    data.recurring.forEach(item => { item.paid[state.recurringMonth] = checked; });
    saveData();
    render();
    toast(`${checked ? "Checked" : "Cleared"} all payments for ${MONTHS[state.recurringMonth]}`);
  }

  function deleteRecurring(id) {
    const item = data.recurring.find(entry => entry.id === id);
    if (!item || !confirm(`Delete ${item.name} from every month?`)) return;
    data.recurring = data.recurring.filter(entry => entry.id !== id);
    saveData();
    render();
    toast("Recurring payment deleted");
  }

  function deleteCreditCard(id) {
    const card = data.creditCards.find(entry => entry.id === id);
    if (!card || !confirm(`Delete ${card.name} and its payment history?`)) return;
    data.creditCards = data.creditCards.filter(entry => entry.id !== id);
    saveData();
    render();
    toast("Credit card deleted");
  }

  function deleteZipPurchase(id) {
    const purchase = data.zipPurchases.find(item => item.id === id);
    if (!purchase || !confirm(`Delete ${purchase.name} and its installment schedule?`)) return;
    data.zipPurchases = data.zipPurchases.filter(item => item.id !== id);
    saveData();
    render();
    toast("ZIP purchase deleted");
  }

  function deleteCategory(type, category) {
    let used = false;
    data.monthly.forEach(month => {
      if (number(month[type === "expense" ? "budgets" : type][category])) used = true;
      if (type === "expense" && month.transactions.some(item => item.category === category)) used = true;
      if (type === "income" && month.incomeEntries.some(item => item.category === category)) used = true;
    });
    if (used) {
      toast("Clear this category's amounts and transactions before deleting it");
      return;
    }
    if (data.categories[type].length <= 1) {
      toast("Keep at least one category in this section");
      return;
    }
    data.categories[type] = data.categories[type].filter(item => item !== category);
    saveData();
    render();
    toast(`${category} deleted`);
  }

  function deleteTodo(id) {
    const monthIndex = state.view === "calendar" ? state.calendarMonth : state.month;
    monthData(monthIndex).todos = monthData(monthIndex).todos.filter(item => item.id !== id);
    saveData();
    render();
  }

  function openModal(title, eyebrow, html, onSubmit) {
    modalTitle.textContent = title;
    modalEyebrow.textContent = eyebrow;
    modalForm.innerHTML = html;
    modalBackdrop.classList.remove("hidden");
    document.body.classList.add("modal-open");
    modalForm.onsubmit = event => {
      event.preventDefault();
      onSubmit(new FormData(modalForm));
    };
    requestAnimationFrame(() => modalForm.querySelector("input,select,textarea")?.focus());
  }

  function closeModal() {
    modalBackdrop.classList.add("hidden");
    document.body.classList.remove("modal-open");
    modalForm.innerHTML = "";
    modalForm.onsubmit = null;
  }

  function openTransactionModal(monthIndex, preferredDay) {
    const selectedMonth = monthIndex === undefined ? (today.getFullYear() === number(data.settings.year) ? today.getMonth() : 0) : monthIndex;
    const defaultDay = preferredDay || (today.getFullYear() === number(data.settings.year) && today.getMonth() === selectedMonth ? today.getDate() : 1);
    openModal("Add transaction", "NEW EXPENSE", `<div class="form-grid">
      <div class="field"><label>Month</label><select name="month">${MONTHS.map((month,index) => `<option value="${index}" ${index===selectedMonth ? "selected" : ""}>${month}</option>`).join("")}</select></div>
      <div class="field"><label>Day</label><input name="day" type="number" min="1" max="31" value="${defaultDay}" required></div>
      <div class="field"><label>Category</label><select name="category">${data.categories.expense.map(category => `<option>${escapeHtml(category)}</option>`).join("")}</select></div>
      <div class="field"><label>Amount</label><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required></div>
      <div class="field span-2"><label>Description</label><input name="description" maxlength="100" placeholder="What was this for?"></div>
    </div><div class="modal-actions"><button type="button" class="ghost-button" data-modal-cancel>Cancel</button><button class="primary-button">Save transaction</button></div>`, form => {
      const index = number(form.get("month"));
      const maxDay = new Date(number(data.settings.year), index + 1, 0).getDate();
      monthData(index).transactions.push({
        id: makeId(),
        day: Math.min(maxDay, Math.max(1, number(form.get("day")))),
        category: String(form.get("category")),
        amount: Math.max(0, number(form.get("amount"))),
        description: String(form.get("description") || "").trim()
      });
      state.month = index;
      saveData();
      closeModal();
      render();
      toast("Transaction added");
    });
    modalForm.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  }

  function openEditTransactionModal(id, originalMonthIndex) {
    const transaction = monthData(originalMonthIndex).transactions.find(item => item.id === id);
    if (!transaction) { toast("Transaction could not be found"); return; }
    openModal("Edit transaction", "UPDATE EXPENSE", `<div class="form-grid">
      <div class="field"><label>Month</label><select name="month">${MONTHS.map((month,index) => `<option value="${index}" ${index===originalMonthIndex ? "selected" : ""}>${month}</option>`).join("")}</select></div>
      <div class="field"><label>Day</label><input name="day" type="number" min="1" max="31" value="${number(transaction.day)}" required></div>
      <div class="field"><label>Category</label><select name="category">${data.categories.expense.map(category => `<option value="${escapeHtml(category)}" ${category===transaction.category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></div>
      <div class="field"><label>Amount</label><input name="amount" type="number" min="0.01" step="0.01" value="${number(transaction.amount)}" required></div>
      <div class="field span-2"><label>Description</label><input name="description" maxlength="100" value="${escapeHtml(transaction.description || "")}" placeholder="What was this for?"></div>
    </div><div class="modal-actions"><button type="button" class="ghost-button" data-modal-cancel>Cancel</button><button class="primary-button">Save changes</button></div>`, form => {
      const selectedMonth = number(form.get("month"));
      const maxDay = new Date(number(data.settings.year), selectedMonth + 1, 0).getDate();
      const updated = {
        ...transaction,
        day: Math.min(maxDay, Math.max(1, number(form.get("day")))),
        category: String(form.get("category")),
        amount: Math.max(0.01, number(form.get("amount"))),
        description: String(form.get("description") || "").trim()
      };
      monthData(originalMonthIndex).transactions = monthData(originalMonthIndex).transactions.filter(item => item.id !== id);
      monthData(selectedMonth).transactions.push(updated);
      state.month = selectedMonth;
      saveData();
      closeModal();
      render();
      toast("Transaction updated");
    });
    modalForm.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  }

  function openIncomeModal(monthIndex = state.month, preferredDay) {
    const defaultDay = preferredDay || (today.getFullYear() === number(data.settings.year) && today.getMonth() === monthIndex ? today.getDate() : 1);
    openModal("Add paycheck", "DATED INCOME", `<div class="form-grid">
      <div class="field"><label>Month</label><select name="month">${MONTHS.map((month,index) => `<option value="${index}" ${index===monthIndex ? "selected" : ""}>${month}</option>`).join("")}</select></div>
      <div class="field"><label>Day received</label><input name="day" type="number" min="1" max="31" value="${defaultDay}" required></div>
      <div class="field"><label>Income category</label><select name="category">${data.categories.income.map(category => `<option>${escapeHtml(category)}</option>`).join("")}</select></div>
      <div class="field"><label>Amount</label><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required></div>
      <div class="field span-2"><label>Employer or source</label><input name="description" maxlength="100" placeholder="Main job, overtime, side job..."></div>
    </div><div class="modal-actions"><button type="button" class="ghost-button" data-modal-cancel>Cancel</button><button class="primary-button">Save paycheck</button></div>`, form => {
      const selectedMonth = number(form.get("month"));
      const maxDay = new Date(number(data.settings.year), selectedMonth + 1, 0).getDate();
      monthData(selectedMonth).incomeEntries.push({ id: makeId(), day: Math.min(maxDay,Math.max(1,number(form.get("day")))), category: String(form.get("category")), amount: Math.max(0,number(form.get("amount"))), description: String(form.get("description") || "").trim() });
      state.month = selectedMonth;
      state.week = Math.min(4,Math.floor((Math.min(maxDay,Math.max(1,number(form.get("day"))))-1)/7));
      saveData();
      closeModal();
      render();
      toast("Paycheck added");
    });
    modalForm.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  }

  function openCreditCardModal(editId) {
    const existing = editId ? data.creditCards.find(card => card.id === editId) : null;
    if (editId && !existing) { toast("That credit card could not be found"); return; }
    openModal(existing ? "Edit credit card" : "Add credit card", "CREDIT DEBT", `<div class="form-grid">
      <div class="field span-2"><label>Card name</label><input name="name" maxlength="60" value="${escapeHtml(existing && existing.name || "")}" placeholder="Freedom, Platinum, Store card..." required></div>
      <div class="field"><label>Bank or issuer</label><input name="issuer" maxlength="60" value="${escapeHtml(existing && existing.issuer || "")}" placeholder="Chase, Capital One..."></div>
      <div class="field"><label>Last 4 digits</label><input name="lastFour" inputmode="numeric" maxlength="4" pattern="[0-9]{0,4}" value="${escapeHtml(existing && existing.lastFour || "")}" placeholder="1234"></div>
      <div class="field"><label>Current balance</label><input name="balance" type="number" min="0" step="0.01" value="${existing ? number(existing.balance) : ""}" placeholder="0.00" required></div>
      <div class="field"><label>Credit limit</label><input name="limit" type="number" min="0" step="0.01" value="${existing ? number(existing.limit) || "" : ""}" placeholder="0.00"></div>
      <div class="field"><label>APR percentage</label><input name="apr" type="number" min="0" max="100" step="0.01" value="${existing ? number(existing.apr) || "" : ""}" placeholder="24.99"></div>
      <div class="field"><label>Minimum payment</label><input name="minimumPayment" type="number" min="0" step="0.01" value="${existing ? number(existing.minimumPayment) || "" : ""}" placeholder="35.00"></div>
      <div class="field"><label>Due day</label><input name="dueDay" type="number" min="1" max="31" value="${existing ? number(existing.dueDay) : 1}" required></div>
      <div class="field"><label>Card color</label><input name="color" type="color" value="${escapeHtml(existing && existing.color || "#63b3ff")}"></div>
    </div><div class="modal-actions"><button type="button" class="ghost-button" data-modal-cancel>Cancel</button><button class="primary-button">${existing ? "Save changes" : "Add card"}</button></div>`, form => {
      const balance = Math.max(0,number(form.get("balance")));
      const updated = {
        id: existing ? existing.id : makeId(),
        name: String(form.get("name") || "Credit card").trim(),
        issuer: String(form.get("issuer") || "").trim(),
        lastFour: String(form.get("lastFour") || "").replace(/\D/g,"").slice(-4),
        balance,
        startingBalance: existing ? Math.max(number(existing.startingBalance),balance) : balance,
        limit: Math.max(0,number(form.get("limit"))),
        apr: Math.max(0,number(form.get("apr"))),
        minimumPayment: Math.max(0,number(form.get("minimumPayment"))),
        dueDay: Math.min(31,Math.max(1,number(form.get("dueDay")))),
        color: /^#[0-9a-f]{6}$/i.test(String(form.get("color"))) ? String(form.get("color")) : "#63b3ff",
        payments: existing ? existing.payments : []
      };
      if (existing) Object.assign(existing,updated); else data.creditCards.push(updated);
      saveData();
      closeModal();
      render();
      toast(existing ? "Credit card updated" : "Credit card added");
    });
    modalForm.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  }

  function openCreditCardPaymentModal(id) {
    const card = data.creditCards.find(entry => entry.id === id);
    if (!card) { toast("That credit card could not be found"); return; }
    const localToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    openModal(`Pay ${card.name}`, "RECORD PAYMENT", `<div class="payment-balance-callout"><span>Current balance</span><strong>${formatMoney(card.balance)}</strong></div><div class="form-grid"><div class="field"><label>Payment amount</label><input name="amount" type="number" min="0.01" max="${number(card.balance)}" step="0.01" value="${Math.min(number(card.minimumPayment),number(card.balance)) || ""}" placeholder="0.00" required></div><div class="field"><label>Payment date</label><input name="date" type="date" value="${localToday}" required></div><div class="field span-2"><label>Note</label><input name="note" maxlength="100" placeholder="Minimum payment, extra payment..."></div></div><div class="info-callout">This payment immediately reduces the card balance and updates credit debt throughout TrueBalance.</div><div class="modal-actions"><button type="button" class="ghost-button" data-modal-cancel>Cancel</button><button class="primary-button">Record payment</button></div>`, form => {
      const amount = Math.min(number(card.balance),Math.max(.01,number(form.get("amount"))));
      card.balance = Math.max(0,number(card.balance)-amount);
      card.payments.push({ id:makeId(), date:String(form.get("date") || localToday), amount, note:String(form.get("note") || "").trim() });
      saveData();
      closeModal();
      render();
      toast(`${formatMoney(amount)} payment recorded`);
    });
    modalForm.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  }

  function imageFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || !String(file.type).startsWith("image/")) return reject(new Error("Choose an image file"));
      if (file.size > 8 * 1024 * 1024) return reject(new Error("Choose an image smaller than 8 MB"));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("That image could not be read"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("That image format is not supported"));
        image.onload = () => {
          const size = 180;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext("2d");
          if (!context) return reject(new Error("Image editing is unavailable in this browser"));
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          resolve(canvas.toDataURL("image/jpeg", .84));
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function openRecurringModal(defaultKind, editId) {
    const existing = editId ? data.recurring.find(item => item.id === editId) : null;
    if (editId && !existing) { toast("That payment could not be found"); return; }
    const kind = existing ? existing.kind : (defaultKind || "bill");
    const icon = existing && existing.icon || (kind === "subscription" ? "🎧" : "🧾");
    const image = existing && existing.image || "";
    const preview = existing ? recurringVisual(existing,0,"recurring-image-preview") : `<span class="recurring-image-preview">${icon}</span>`;
    openModal(existing ? "Edit recurring payment" : "Add recurring payment", "BILL OR SUBSCRIPTION", `<div class="recurring-image-editor"><div id="recurringImagePreview">${preview}</div><div><strong>Payment image</strong><p>Choose an icon or upload a photo/logo from this device.</p></div></div><div class="form-grid">
      <div class="field"><label>Icon</label><select name="icon" id="recurringIconSelect">${RECURRING_ICONS.map(choice => `<option value="${choice}" ${choice===icon ? "selected" : ""}>${choice} ${choice === "🧾" ? "Bill" : choice === "🎧" ? "Subscription" : ""}</option>`).join("")}</select></div>
      <div class="field"><label>Custom image</label><input name="imageFile" id="recurringImageFile" type="file" accept="image/*"></div>
      <input name="imageData" id="recurringImageData" type="hidden" value="${escapeHtml(image)}">
      <div class="field span-2"><button type="button" class="ghost-button compact" id="removeRecurringImage" ${image ? "" : "disabled"}>Remove uploaded image</button></div>
      <div class="field"><label>Type</label><select name="kind"><option value="bill" ${kind==="bill" ? "selected" : ""}>Bill</option><option value="subscription" ${kind==="subscription" ? "selected" : ""}>Subscription</option></select></div>
      <div class="field"><label>Due day</label><input name="dueDay" type="number" min="1" max="31" value="${existing ? number(existing.dueDay) : 1}" required></div>
      <div class="field span-2"><label>Name</label><input name="name" maxlength="70" value="${escapeHtml(existing && existing.name || "")}" placeholder="Rent, phone, streaming..." required></div>
      <div class="field span-2"><label>Monthly amount</label><input name="amount" type="number" min="0" step="0.01" value="${existing ? number(existing.amount) : ""}" placeholder="0.00" required></div>
    </div><div class="modal-actions"><button type="button" class="ghost-button" data-modal-cancel>Cancel</button><button class="primary-button">${existing ? "Save changes" : "Add payment"}</button></div>`, form => {
      const updated = {
        id: existing ? existing.id : makeId(),
        kind: String(form.get("kind")),
        name: String(form.get("name") || "").trim(),
        amount: Math.max(0, number(form.get("amount"))),
        dueDay: Math.min(31, Math.max(1, number(form.get("dueDay")))),
        icon: String(form.get("icon") || "").slice(0,12),
        image: /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(String(form.get("imageData") || "")) ? String(form.get("imageData")) : "",
        paid: existing ? existing.paid : {}
      };
      if (existing) Object.assign(existing, updated);
      else data.recurring.push(updated);
      saveData();
      closeModal();
      render();
      toast(existing ? "Recurring payment updated" : "Recurring payment added");
    });
    const previewBox = modalForm.querySelector("#recurringImagePreview");
    const imageData = modalForm.querySelector("#recurringImageData");
    const imageInput = modalForm.querySelector("#recurringImageFile");
    const iconSelect = modalForm.querySelector("#recurringIconSelect");
    const removeImage = modalForm.querySelector("#removeRecurringImage");
    iconSelect.addEventListener("change", () => { if (!imageData.value) previewBox.innerHTML = `<span class="recurring-image-preview">${escapeHtml(iconSelect.value)}</span>`; });
    imageInput.addEventListener("change", async () => {
      try {
        const converted = await imageFileToDataUrl(imageInput.files && imageInput.files[0]);
        imageData.value = converted;
        previewBox.innerHTML = `<span class="recurring-image-preview has-image"><img src="${converted}" alt=""></span>`;
        removeImage.disabled = false;
      } catch (error) { imageInput.value = ""; toast(error.message); }
    });
    removeImage.addEventListener("click", () => {
      imageData.value = "";
      imageInput.value = "";
      removeImage.disabled = true;
      previewBox.innerHTML = `<span class="recurring-image-preview">${escapeHtml(iconSelect.value)}</span>`;
    });
    modalForm.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  }

  function openZipModal() {
    const localToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    openModal("Add ZIP purchase", "INSTALLMENT PLAN", `<div class="form-grid">
      <div class="field span-2"><label>Purchase name</label><input name="name" maxlength="80" placeholder="Shoes, electronics, furniture..." required></div>
      <div class="field"><label>Store</label><input name="store" maxlength="70" placeholder="Store name"></div>
      <div class="field"><label>Total purchase</label><input name="total" type="number" min="0.01" step="0.01" placeholder="0.00" required></div>
      <div class="field"><label>First payment date</label><input name="firstDate" type="date" value="${localToday}" required></div>
      <div class="field"><label>Number of payments</label><input name="installments" type="number" min="2" max="12" value="4" required></div>
      <div class="field span-2"><label>Payment frequency</label><select name="frequency"><option value="14" selected>Every 2 weeks</option><option value="7">Every week</option><option value="30">Every 30 days</option></select></div>
      <div class="field span-2"><label>Order number or notes</label><input name="notes" maxlength="120" placeholder="Optional"></div>
    </div><div class="info-callout" style="margin-top:14px">TrueBalance will divide the total evenly. Each installment counts as an expense only after you check it as paid.</div><div class="modal-actions"><button type="button" class="ghost-button" data-modal-cancel>Cancel</button><button class="primary-button">Create payment plan</button></div>`, form => {
      const total = Math.max(.01, number(form.get("total")));
      const count = Math.min(12, Math.max(2, Math.round(number(form.get("installments")))));
      const frequency = number(form.get("frequency")) || 14;
      const first = new Date(`${String(form.get("firstDate"))}T12:00:00`);
      const baseCents = Math.floor(Math.round(total * 100) / count);
      let assignedCents = 0;
      const payments = Array.from({length:count},(_,index) => {
        const due = new Date(first); due.setDate(first.getDate() + frequency * index);
        const cents = index === count - 1 ? Math.round(total * 100) - assignedCents : baseCents;
        assignedCents += cents;
        return { id:makeId(), dueDate:`${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,"0")}-${String(due.getDate()).padStart(2,"0")}`, amount:cents/100, paid:false };
      });
      data.zipPurchases.push({ id:makeId(), name:String(form.get("name") || "ZIP purchase").trim(), store:String(form.get("store") || "").trim(), total, notes:String(form.get("notes") || "").trim(), payments });
      saveData();
      closeModal();
      render();
      toast("ZIP payment plan added");
    });
    modalForm.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    const filename = `truebalance-budget-${data.settings.year}.json`;
    downloadFile(filename, JSON.stringify(data, null, 2), "application/json");
    toast("Backup exported");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
  }

  function exportCsv() {
    const rows = [["Month","Day","Category","Description","Amount"]];
    allTransactions().reverse().forEach(item => rows.push([MONTHS[item.month], item.day, item.category, item.description || "", item.amount]));
    downloadFile(`truebalance-transactions-${data.settings.year}.csv`, rows.map(row => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
    toast("Transactions exported");
  }

  function resetData() {
    if (!confirm("Reset all budget data? This cannot be undone unless you exported a backup.")) return;
    data = defaultData();
    state.month = 0;
    state.week = 0;
    state.calendarMonth = 0;
    state.recurringMonth = 0;
    saveData();
    setView("dashboard");
    toast("Planner reset");
  }

  function openMobileMenu() {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("mobileScrim").classList.add("open");
  }
  function closeMobileMenu() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("mobileScrim").classList.remove("open");
  }

  function applySidebarState() {
    document.body.dataset.sidebarCollapsed = String(data.settings.sidebarCollapsed);
    const button = document.getElementById("menuButton");
    if (!button) return;
    button.textContent = data.settings.sidebarCollapsed ? "☰" : "‹";
    button.setAttribute("aria-label", data.settings.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
    button.title = data.settings.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  }

  function toggleSidebar() {
    data.settings.sidebarCollapsed = !data.settings.sidebarCollapsed;
    saveData();
    applySidebarState();
  }

  function bindNavigation() {
    const nav = document.querySelector(".main-nav");
    document.querySelectorAll(".nav-item[data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
    if (!nav) return;
    let draggedTab = null;
    nav.querySelectorAll(".nav-item[data-view]").forEach(button => {
      button.draggable = true;
      button.addEventListener("dragstart", event => {
        draggedTab = button.dataset.view;
        button.classList.add("dragging");
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      button.addEventListener("dragend", () => { button.classList.remove("dragging"); draggedTab = null; });
      button.addEventListener("dragover", event => { event.preventDefault(); button.classList.add("drag-over"); });
      button.addEventListener("dragleave", () => button.classList.remove("drag-over"));
      button.addEventListener("drop", event => {
        event.preventDefault();
        button.classList.remove("drag-over");
        const targetTab = button.dataset.view;
        if (!draggedTab || draggedTab === targetTab) return;
        const order = data.settings.tabOrder.filter(tab => tab !== draggedTab);
        order.splice(order.indexOf(targetTab), 0, draggedTab);
        data.settings.tabOrder = order;
        saveData();
        applyNavOrder();
        toast("Tab order saved");
      });
    });
  }

  applyNavOrder();
  bindNavigation();
  document.getElementById("quickAddTransaction").addEventListener("click", () => openTransactionModal(state.view === "monthly" ? state.month : undefined));
  document.getElementById("quickAddBill").addEventListener("click", () => openRecurringModal());
  document.getElementById("toggleResizeBoxes").addEventListener("click", () => {
    state.resizeBoxes = !state.resizeBoxes;
    state.dashboardArrange = state.resizeBoxes;
    render();
  });
  document.getElementById("closeModal").addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", event => { if (event.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !modalBackdrop.classList.contains("hidden")) closeModal(); });
  document.getElementById("menuButton").addEventListener("click", toggleSidebar);
  document.getElementById("mobileScrim").addEventListener("click", closeMobileMenu);

  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        if (!imported.settings || !imported.categories || !imported.monthly) throw new Error("Not a TrueBalance backup");
        if (!confirm("Replace the current planner with this backup?")) return;
        data = normalizeData(imported);
        applyNavOrder();
        saveData();
        state.month = 0;
        state.calendarMonth = 0;
        setView("dashboard");
        toast("Backup imported");
      } catch (error) {
        console.warn(error);
        toast("This file is not a valid budget backup");
      } finally {
        importInput.value = "";
      }
    };
    reader.readAsText(file);
  });

  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { data = normalizeData(JSON.parse(event.newValue)); applyNavOrder(); render(); } catch { /* ignore */ }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && cloudSession && cloudConfigured()) {
      refreshCloudSession().then(valid => { if (valid) { startRealtimeSync(); reconcileCloud().catch(() => {}); } });
    }
  });
  window.addEventListener("online", () => {
    if (cloudSession && cloudConfigured()) { startRealtimeSync(); reconcileCloud().catch(() => {}); }
  });

  headerYear.textContent = data.settings.year;
  render();
  if (cloudSession && cloudConfigured()) { startRealtimeSync(); reconcileCloud().catch(() => { /* local copy remains available */ }); }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* offline support is optional */ });
  }
})();
