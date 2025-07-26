// Конфигурация API
const API_CONFIG = {
    RECONNECT_INTERVAL: 5000,
    TIMEOUT: 10000,
    MAX_RETRIES: 3,
    ENDPOINTS: {
        TEST: 'https://api.binance.com/api/v3/ping',
        FUTURES: 'https://fapi.binance.com',
        SPOT: 'https://api.binance.com',
        HISTORICAL: 'https://api.binance.com/api/v3/klines',
        ALL_TICKERS: 'https://api.binance.com/api/v3/exchangeInfo'
    },
    PRICE_COMPARISON_EPSILON: 0.00000001,
    TREND_ANALYSIS_PERIOD: 14 // Days for trend analysis
};

// Объект для хранения данных о тикерах
const tickersData = {
    'long': {},
    'short': {},
    'long-wait': {},
    'short-wait': {}
};

// Кэш для всех тикеров Binance
let allBinanceTickers = {};
let tickersLoaded = false;

// Переменные для модальных окон
const priceModal = document.getElementById('priceModal');
const modalTicker = document.getElementById('modalTicker');
const priceInput = document.getElementById('priceInput');
const changeInput = document.getElementById('changeInput');
const commentModal = document.getElementById('commentModal');
const commentModalTicker = document.getElementById('commentModalTicker');
const commentInput = document.getElementById('commentInput');
let currentTicker = '';
let currentListType = '';

// Переменная для хранения виджета TradingView
let tradingViewWidget = null;

let apiManager;

class BinanceAPIManager {
    constructor() {
        this.connectionState = {
            connected: false,
            lastCheck: null,
            retries: 0,
            error: null
        };
        this.priceHistoryCache = {}; // Cache for price history data
    }

    async init() {
        await this.checkAPIConnection();
        this.startHealthCheck();
        await this.loadAllTickers();
    }

    async checkAPIConnection() {
        try {
            const response = await this._fetchWithTimeout(
                API_CONFIG.ENDPOINTS.TEST,
                { method: 'GET' }
            );

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            this._updateConnectionState({
                connected: true,
                retries: 0,
                error: null
            });

            return true;
        } catch (error) {
            this._handleConnectionError(error);
            return false;
        }
    }

    async _fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    _updateConnectionState(stateUpdate) {
        this.connectionState = {
            ...this.connectionState,
            ...stateUpdate,
            lastCheck: new Date().toISOString()
        };

        this._updateUIStatus();
    }

    _handleConnectionError(error) {
        const newRetries = this.connectionState.retries + 1;
        const fatal = newRetries >= API_CONFIG.MAX_RETRIES;

        this._updateConnectionState({
            connected: false,
            retries: newRetries,
            error: fatal ? 'Fatal connection error' : error.message
        });

        if (!fatal) {
            setTimeout(() => this.checkAPIConnection(), API_CONFIG.RECONNECT_INTERVAL);
        }
    }

    startHealthCheck() {
        setInterval(() => {
            if (!this.connectionState.connected) {
                this.checkAPIConnection();
            }
        }, 30000);
    }

    _updateUIStatus() {
        const statusElement = document.getElementById('connectionStatus');
        if (!statusElement) return;

        const dotElement = statusElement.querySelector('.status-dot');
        const textElement = statusElement.querySelector('span');

        if (!dotElement || !textElement) return;

        if (this.connectionState.connected) {
            statusElement.classList.add('connected');
            statusElement.classList.remove('error');
            dotElement.classList.add('status-connected');
            dotElement.classList.remove('status-error');
            textElement.textContent = `Connected to Binance (${new Date(this.connectionState.lastCheck).toLocaleTimeString()})`;
        } else {
            statusElement.classList.add('error');
            statusElement.classList.remove('connected');
            dotElement.classList.add('status-error');
            dotElement.classList.remove('status-connected');
            textElement.textContent = `Connection error: ${this.connectionState.error || 'Unknown error'} [Retry ${this.connectionState.retries}/${API_CONFIG.MAX_RETRIES}]`;
        }
    }

    async loadAllTickers() {
        try {
            const response = await this._fetchWithTimeout(API_CONFIG.ENDPOINTS.ALL_TICKERS);
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            // Очищаем предыдущий список
            allBinanceTickers = {};
            
            // Заполняем список всех тикеров
            data.symbols.forEach(symbol => {
                if (symbol.status === 'TRADING' && symbol.symbol.endsWith('USDT')) {
                    allBinanceTickers[symbol.symbol] = {
                        name: symbol.baseAsset,
                        type: 'spot'
                    };
                }
            });
            
            // Загружаем фьючерсные тикеры
            await this.loadFuturesTickers();
            
            tickersLoaded = true;
            console.log('Loaded all Binance tickers:', Object.keys(allBinanceTickers).length);
        } catch (error) {
            console.error('Error loading all tickers:', error);
            // Если не удалось загрузить, используем стандартный список
            this.loadDefaultTickers();
        }
    }

    async loadFuturesTickers() {
        try {
            const response = await this._fetchWithTimeout('https://fapi.binance.com/fapi/v1/exchangeInfo');
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            // Добавляем фьючерсные тикеры
            data.symbols.forEach(symbol => {
                if (symbol.status === 'TRADING' && symbol.symbol.endsWith('USDT')) {
                    allBinanceTickers[symbol.symbol] = {
                        name: symbol.baseAsset,
                        type: 'futures'
                    };
                }
            });
        } catch (error) {
            console.error('Error loading futures tickers:', error);
        }
    }

    loadDefaultTickers() {
        // Стандартный список популярных тикеров
        allBinanceTickers = {
            'BTCUSDT': { name: 'Bitcoin', type: 'spot' },
            'ETHUSDT': { name: 'Ethereum', type: 'spot' },
            'BNBUSDT': { name: 'Binance Coin', type: 'spot' },
            'SOLUSDT': { name: 'Solana', type: 'spot' },
            'XRPUSDT': { name: 'Ripple', type: 'spot' },
            'ADAUSDT': { name: 'Cardano', type: 'spot' },
            'DOGEUSDT': { name: 'Dogecoin', type: 'spot' },
            'DOTUSDT': { name: 'Polkadot', type: 'spot' },
            'SHIBUSDT': { name: 'Shiba Inu', type: 'spot' },
            'MATICUSDT': { name: 'Polygon', type: 'spot' },
            'BTCUSDT': { name: 'Bitcoin Futures', type: 'futures' },
            'ETHUSDT': { name: 'Ethereum Futures', type: 'futures' },
            'SOLUSDT': { name: 'Solana Futures', type: 'futures' },
            'XRPUSDT': { name: 'Ripple Futures', type: 'futures' },
            'ADAUSDT': { name: 'Cardano Futures', type: 'futures' },
            'LINKUSDT': { name: 'Chainlink', type: 'spot' },
            'AVAXUSDT': { name: 'Avalanche', type: 'spot' },
            'LTCUSDT': { name: 'Litecoin', type: 'spot' },
            'ATOMUSDT': { name: 'Cosmos', type: 'spot' },
            'UNIUSDT': { name: 'Uniswap', type: 'spot' },
            'LINKUSDT': { name: 'Chainlink Futures', type: 'futures' },
            'AVAXUSDT': { name: 'Avalanche Futures', type: 'futures' },
            'LTCUSDT': { name: 'Litecoin Futures', type: 'futures' },
            'ATOMUSDT': { name: 'Cosmos Futures', type: 'futures' },
            'UNIUSDT': { name: 'Uniswap Futures', type: 'futures' }
        };
    }

    async getCurrentPrice(symbol, marketType) {
        try {
            const endpoint = marketType === 'futures'
                ? `${API_CONFIG.ENDPOINTS.FUTURES}/fapi/v1/ticker/price?symbol=${symbol}`
                : `${API_CONFIG.ENDPOINTS.SPOT}/api/v3/ticker/price?symbol=${symbol}`;

            const response = await this._fetchWithTimeout(endpoint);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();

            // Валидация ответа API
            if (!data || typeof data.price !== 'string') {
                console.error('Invalid price data:', data);
                return null;
            }

            const price = parseFloat(data.price);
            return isNaN(price) ? null : price;
        } catch (error) {
            console.error(`Error getting price for ${symbol}:`, error);
            return null;
        }
    }

    async getPriceHistory(symbol, marketType = 'spot', days = API_CONFIG.TREND_ANALYSIS_PERIOD) {
        const cacheKey = `${symbol}-${marketType}-${days}`;
        
        // Check cache first
        if (this.priceHistoryCache[cacheKey] && 
            Date.now() - this.priceHistoryCache[cacheKey].timestamp < 600000) { // 10 minute cache
            return this.priceHistoryCache[cacheKey].data;
        }

        try {
            const interval = days <= 7 ? '1h' : days <= 30 ? '4h' : '1d';
            const limit = Math.min(days * 24, 1000); // Binance max limit is 1000
            
            const endpoint = marketType === 'futures'
                ? `${API_CONFIG.ENDPOINTS.FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
                : `${API_CONFIG.ENDPOINTS.SPOT}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

            const response = await this._fetchWithTimeout(endpoint);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            
            // Cache the data
            this.priceHistoryCache[cacheKey] = {
                data: data,
                timestamp: Date.now()
            };

            return data;
        } catch (error) {
            console.error(`Error getting price history for ${symbol}:`, error);
            return null;
        }
    }

    async analyzeTrend(symbol, marketType = 'spot') {
        try {
            const history = await this.getPriceHistory(symbol, marketType);
            if (!history || history.length < 2) return null;

            // Extract closing prices
            const closes = history.map(item => parseFloat(item[4]));
            
            // Simple moving average calculation
            const sma = closes.reduce((sum, price) => sum + price, 0) / closes.length;
            
            // Latest price
            const latestPrice = closes[closes.length - 1];
            
            // Determine trend
            if (latestPrice > sma * 1.05) {
                return { direction: 'up', confidence: Math.min(100, Math.round((latestPrice - sma) / sma * 1000)) };
            } else if (latestPrice < sma * 0.95) {
                return { direction: 'down', confidence: Math.min(100, Math.round((sma - latestPrice) / sma * 1000)) };
            } else {
                return { direction: 'neutral', confidence: 0 };
            }
        } catch (error) {
            console.error(`Error analyzing trend for ${symbol}:`, error);
            return null;
        }
    }
}

// Функции для работы с пользователями
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function handleRegister() {
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword')?.value;

    // Валидация полей
    if (!email || !password || !confirmPassword) {
        showNotification('Ошибка', 'Все поля обязательны для заполнения');
        return;
    }

    if (!isValidEmail(email)) {
        showNotification('Ошибка', 'Введите корректный email');
        return;
    }

    if (password.length < 8) {
        showNotification('Ошибка', 'Пароль должен содержать минимум 8 символов');
        return;
    }

    if (password !== confirmPassword) {
        showNotification('Ошибка', 'Пароли не совпадают');
        return;
    }

    // Проверяем, есть ли уже такой пользователь
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const userExists = users.some(user => user.email === email);

    if (userExists) {
        showNotification('Ошибка', 'Пользователь с таким email уже зарегистрирован');
        return;
    }

    // Создаем нового пользователя
    const newUser = {
        email: email,
        password: btoa(password), // Простое шифрование (не безопасно для продакшена!)
        createdAt: new Date().toISOString()
    };

    // Сохраняем пользователя
    users.push(newUser);
    localStorage.setItem('users', JSON.stringify(users));
    localStorage.setItem('currentUser', JSON.stringify({ email: email }));
    showNotification('Успех', 'Регистрация прошла успешно!');
    closeRegisterModal();

    // Обновляем интерфейс для зарегистрированного пользователя
    updateUserUI(email);
}

function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showNotification('Ошибка', 'Введите email и пароль');
        return;
    }

    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => u.email === email && atob(u.password) === password);

    if (!user) {
        showNotification('Ошибка', 'Неверный email или пароль');
        return;
    }

    localStorage.setItem('currentUser', JSON.stringify({ email: email }));
    showNotification('Успех', 'Вход выполнен успешно!');
    closeLoginModal();
    updateUserUI(email);
}

function handleLogout() {
    localStorage.removeItem('currentUser');
    showNotification('Успех', 'Вы успешно вышли из системы');
    updateUserUI(null);
    toggleMenu();
}

function updateUserUI(email) {
    const userProfileBtn = document.getElementById('userProfileBtn');
    const userName = document.getElementById('userName');
    const loginMenuItem = document.getElementById('loginMenuItem');
    const registerMenuItem = document.getElementById('registerMenuItem');
    const logoutMenuItem = document.getElementById('logoutMenuItem');

    if (email) {
        // Пользователь авторизован
        if (userProfileBtn) userProfileBtn.classList.remove('hidden');
        if (userName) userName.textContent = email.split('@')[0];
        if (loginMenuItem) loginMenuItem.classList.add('hidden');
        if (registerMenuItem) registerMenuItem.classList.add('hidden');
        if (logoutMenuItem) logoutMenuItem.classList.remove('hidden');
    } else {
        // Гость
        if (userProfileBtn) userProfileBtn.classList.add('hidden');
        if (loginMenuItem) loginMenuItem.classList.remove('hidden');
        if (registerMenuItem) registerMenuItem.classList.remove('hidden');
        if (logoutMenuItem) logoutMenuItem.classList.add('hidden');
    }
}

function showNotification(title, message) {
    // Создаем уведомление
    const notification = document.createElement('div');
    notification.className = 'fixed bottom-4 right-4 w-80 rounded-lg shadow-lg border-l-4 border-accent-green';
    notification.style.backgroundColor = '#1E1E1E';
    
    notification.innerHTML = `
        <div class="p-4">
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <h3 class="font-medium text-light">${title}</h3>
                    <p class="text-sm text-gray-300 mt-1">${message}</p>
                </div>
                <button class="ml-2 text-gray-400 hover:text-gray-300" onclick="this.parentElement.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Автоматически закрываем через 5 секунд
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Копировать тикер в буфер обмена
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Успех', `Тикер ${text} скопирован в буфер`);
    }).catch(err => {
        console.error('Ошибка копирования:', err);
        showNotification('Ошибка', 'Не удалось скопировать тикер');
    });
}

// Инициализация сортируемых списков
function initializeSortableLists() {
    document.querySelectorAll('.ticker-list').forEach(list => {
        new Sortable(list, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: function(evt) {
                const listType = evt.to.id.replace('-list', '');
                const tickers = Array.from(evt.to.children)
                    .filter(item => item.classList.contains('ticker-item'))
                    .map(item => item.dataset.ticker);

                // Переупорядочиваем объект tickersData
                const reorderedData = {};
                tickers.forEach(ticker => {
                    reorderedData[ticker] = tickersData[listType][ticker];
                });

                tickersData[listType] = reorderedData;
                saveTickersToStorage();
            }
        });
    });
}

// Настройка обработчиков для полей ввода
function setupInputHandlers() {
    document.querySelectorAll('.ticker-input').forEach(input => {
        // Обработчик Enter
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const panel = this.closest('.panel');
                const type = panel.classList.contains('long') ? 'long' :
                            panel.classList.contains('short') ? 'short' :
                            panel.classList.contains('long-wait') ? 'long-wait' : 'short-wait';
                addTicker(type);
            }
        });

        // Обработчик ввода для поиска тикеров
        input.addEventListener('input', function(e) {
            const panel = this.closest('.panel');
            const type = panel.classList.contains('long') ? 'long' :
                        panel.classList.contains('short') ? 'short' :
                        panel.classList.contains('long-wait') ? 'long-wait' : 'short-wait';
            showTickerSuggestions(this.value.trim().toUpperCase(), type);
        });

        // Скрываем подсказки при потере фокуса
        input.addEventListener('blur', function() {
            setTimeout(() => {
                const panel = this.closest('.panel');
                const type = panel.classList.contains('long') ? 'long' :
                            panel.classList.contains('short') ? 'short' :
                            panel.classList.contains('long-wait') ? 'long-wait' : 'short-wait';
                document.getElementById(`${type}-suggestions`).style.display = 'none';
            }, 200);
        });
    });
}

// Показать подсказки для тикеров
function showTickerSuggestions(query, listType) {
    const suggestionsContainer = document.getElementById(`${listType}-suggestions`);
    suggestionsContainer.innerHTML = '';

    if (!query || query.length < 2) {
        suggestionsContainer.style.display = 'none';
        return;
    }

    // Фильтруем тикеры по запросу
    const filteredTickers = Object.keys(allBinanceTickers)
        .filter(ticker => ticker.includes(query))
        .slice(0, 10); // Ограничиваем 10 подсказками

    if (filteredTickers.length === 0) {
        suggestionsContainer.style.display = 'none';
        return;
    }

    // Добавляем подсказки в контейнер
    filteredTickers.forEach(ticker => {
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'suggestion-item';
        suggestionItem.innerHTML = `
            <span class="suggestion-ticker">${ticker}</span>
            <span class="suggestion-type ${allBinanceTickers[ticker].type === 'spot' ? 'spot-type' : 'futures-type'}">
                ${allBinanceTickers[ticker].type === 'spot' ? 'SPOT' : 'FUTURES'}
            </span>
        `;

        suggestionItem.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const input = document.getElementById(`${listType}-input`);
            input.value = ticker;
            suggestionsContainer.style.display = 'none';
            input.focus();
        });

        suggestionsContainer.appendChild(suggestionItem);
    });

    suggestionsContainer.style.display = 'block';
}

// Загрузка тикеров из localStorage
function loadTickersFromStorage() {
    const savedData = localStorage.getItem('cryptoDashboardTickers');

    if (savedData) {
        try {
            const parsedData = JSON.parse(savedData);

            for (const listType in parsedData) {
                if (parsedData.hasOwnProperty(listType)) {
                    tickersData[listType] = parsedData[listType];

                    // Восстанавливаем элементы на странице
                    const list = document.getElementById(`${listType}-list`);
                    list.innerHTML = '';

                    for (const ticker in parsedData[listType]) {
                        if (parsedData[listType].hasOwnProperty(ticker)) {
                            addTickerToList(ticker, listType);
                        }
                    }
                }
            }

            // Обновляем статистику после загрузки
            updateStats();
        } catch (e) {
            console.error('Ошибка при загрузке данных из localStorage:', e);
        }
    }
}

// Сохранение тикеров в localStorage
function saveTickersToStorage() {
    try {
        localStorage.setItem('cryptoDashboardTickers', JSON.stringify(tickersData));
        updateStats();
    } catch (e) {
        console.error('Ошибка при сохранении данных в localStorage:', e);
    }
}

// Добавление тикера
async function addTicker(listType) {
    const input = document.getElementById(`${listType}-input`);
    const errorElement = document.getElementById(`${listType}-error`);
    let ticker = input.value.trim().toUpperCase();

    // Нормализация тикера (удаляем все не-буквы и цифры)
    ticker = ticker.replace(/[^A-Z0-9.]/g, '');

    if (!ticker) {
        showError(errorElement, 'Введите тикер');
        return;
    }

    // Удаляем .P если он есть (больше не используем для фьючерсов)
    if (ticker.includes('.P')) {
        ticker = ticker.replace('.P', '');
    }
    // Добавляем USDT если его нет в конце
    else if (!ticker.endsWith('USDT')) {
        ticker += 'USDT';
    }

    if (tickersData[listType][ticker]) {
        showError(errorElement, 'Этот тикер уже добавлен');
        return;
    }

    // Создаем новый тикер
    const now = new Date();
    
    // Проверяем, есть ли такой тикер в Binance
    const isBinanceTicker = allBinanceTickers.hasOwnProperty(ticker);
    
    tickersData[listType][ticker] = {
        name: isBinanceTicker ? allBinanceTickers[ticker].name : ticker.replace(/USDT$/, ''),
        price: '0.000000',
        change: '0.00',
        isBinance: isBinanceTicker,
        addedDate: now.toISOString(),
        stars: 0,
        marketType: isBinanceTicker ? allBinanceTickers[ticker].type : 'spot', // Сохраняем тип рынка
        comment: '', // Комментарий к тикеру
        trend: null // Информация о тренде
    };

    // Пробуем получить данные с Binance (для spot и futures)
    if (isBinanceTicker) {
        try {
            let apiUrl;
            const marketType = tickersData[listType][ticker].marketType;

            if (marketType === 'futures') {
                // Для фьючерсов используем Futures API
                apiUrl = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${ticker}`;
            } else {
                // Для спота используем Spot API
                apiUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${ticker}`;
            }

            const response = await fetch(apiUrl);

            if (response.ok) {
                const data = await response.json();
                tickersData[listType][ticker].price = parseFloat(data.lastPrice).toFixed(6);
                tickersData[listType][ticker].change = parseFloat(data.priceChangePercent).toFixed(2);

                // Анализируем тренд
                const trend = await apiManager.analyzeTrend(ticker, marketType);
                if (trend) {
                    tickersData[listType][ticker].trend = trend;
                }
            }
        } catch (error) {
            console.error(`Ошибка при проверке тикера ${ticker}:`, error);
        }
    }

    // Добавляем на страницу
    const list = document.getElementById(`${listType}-list`);
    addTickerToList(ticker, listType);
    saveTickersToStorage();
    input.value = '';
    hideError(errorElement);

    // Скрываем подсказки
    document.getElementById(`${listType}-suggestions`).style.display = 'none';

    // Открываем модальное окно для ручного ввода (если не Binance)
    if (!tickersData[listType][ticker].isBinance) {
        editTicker(ticker, listType);
    }
}

// Добавление тикера в список на странице
function addTickerToList(ticker, listType) {
    const list = document.getElementById(`${listType}-list`);
    const tickerData = tickersData[listType][ticker];

    const changeNum = parseFloat(tickerData.change);
    const changeClass = changeNum > 0 ?
                      'positive' :
                      changeNum < 0 ?
                      'negative' : 'neutral';

    const addedDate = new Date(tickerData.addedDate);
    const formattedDate = addedDate.toLocaleString();

    // Создаем звезды рейтинга
    const starsHtml = Array(3).fill(0).map((_, i) =>
        `<i class="star ${i < tickerData.stars ? 'fas' : 'far'} fa-star"
            onclick="rateTicker(event, '${ticker}', '${listType}', ${i + 1})"></i>`
    ).join('');

    // Создаем индикатор тренда
    let trendIndicator = '';
    if (tickerData.trend) {
        const trendClass = tickerData.trend.direction === 'up' ? 'trend-up' :
                         tickerData.trend.direction === 'down' ? 'trend-down' : 'trend-neutral';
        const trendIcon = tickerData.trend.direction === 'up' ? 'fa-arrow-up' :
                         tickerData.trend.direction === 'down' ? 'fa-arrow-down' : 'fa-arrows-left-right';
        
        trendIndicator = `
            <span class="trend-indicator ${trendClass}" title="Тренд: ${tickerData.trend.direction}, уверенность: ${tickerData.trend.confidence}%">
                <i class="fas ${trendIcon}"></i>
                ${tickerData.trend.confidence}%
            </span>
        `;
    }

    const listItem = document.createElement('li');
    listItem.className = 'ticker-item';
    listItem.dataset.ticker = ticker;
    listItem.dataset.listType = listType;

    listItem.innerHTML = `
        <div class="ticker-info">
            <div class="ticker-name-container">
                <span class="ticker-symbol">${ticker}</span>
                ${trendIndicator}
                <div class="star-rating">${starsHtml}</div>
            </div>
            <div class="price-info">
                <div class="price-value">
                    $${tickerData.price}
                    <span class="price-change ${changeClass}">${tickerData.change}%</span>
                </div>
                <div class="added-date">${formattedDate}</div>
            </div>
        </div>
        <div class="action-buttons">
            <button class="action-btn move-btn" onclick="moveTickerUp(event, this)">
                <i class="fas fa-arrow-up"></i>
            </button>
            <button class="action-btn move-btn" onclick="moveTickerDown(event, this)">
                <i class="fas fa-arrow-down"></i>
            </button>
            <button class="action-btn comment-btn" onclick="editComment(event, '${ticker}', '${listType}')">
                <i class="fas fa-comment${tickerData.comment ? '' : '-dots'}"></i>
                ${tickerData.comment ? `<div class="comment-tooltip">${tickerData.comment}</div>` : ''}
            </button>
            <button class="action-btn copy-btn" onclick="copyToClipboard('${ticker}')">
                <i class="fas fa-copy"></i>
            </button>
            <button class="action-btn delete-btn" onclick="removeTicker(event, this)">×</button>
        </div>
    `;

    // Добавляем обработчик клика для открытия графика
    listItem.querySelector('.ticker-info').addEventListener('click', function() {
        openTradingViewChart(ticker, listType);
    });

    list.appendChild(listItem);
}

// Редактирование комментария
function editComment(event, ticker, listType) {
    event.stopPropagation();
    currentTicker = ticker;
    currentListType = listType;
    
    const tickerData = tickersData[listType][ticker];
    commentModalTicker.textContent = ticker;
    commentInput.value = tickerData.comment || '';
    commentModal.style.display = 'flex';
}

// Сохранение комментария
function saveComment() {
    const comment = commentInput.value.trim();
    tickersData[currentListType][currentTicker].comment = comment;
    
    // Обновляем отображение на странице
    const listItem = document.querySelector(`.ticker-item[data-ticker="${currentTicker}"][data-list-type="${currentListType}"]`);
    if (listItem) {
        const commentBtn = listItem.querySelector('.comment-btn');
        const hasComment = comment !== '';
        
        // Обновляем иконку
        const icon = commentBtn.querySelector('i');
        icon.className = hasComment ? 'fas fa-comment' : 'fas fa-comment-dots';
        
        // Обновляем тултип
        let tooltip = commentBtn.querySelector('.comment-tooltip');
        if (hasComment) {
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'comment-tooltip';
                commentBtn.appendChild(tooltip);
            }
            tooltip.textContent = comment;
        } else if (tooltip) {
            tooltip.remove();
        }
    }
    
    saveTickersToStorage();
    closeCommentModal();
}

// Закрытие модального окна комментария
function closeCommentModal() {
    commentModal.style.display = 'none';
}

// Оценить тикер звездами
function rateTicker(event, ticker, listType, rating) {
    event.stopPropagation();
    const tickerData = tickersData[listType][ticker];

    // Если кликнули на ту же звезду, что и текущий рейтинг - снимаем оценку
    tickerData.stars = tickerData.stars === rating ? 0 : rating;

    // Обновляем отображение звезд
    const stars = event.target.parentElement.querySelectorAll('.star');
    stars.forEach((star, i) => {
        star.classList.toggle('fas', i < tickerData.stars);
        star.classList.toggle('far', i >= tickerData.stars);
    });

    saveTickersToStorage();
}

// Переместить тикер вверх
function moveTickerUp(event, button) {
    event.stopPropagation();
    const listItem = button.closest('.ticker-item');
    const prevItem = listItem.previousElementSibling;

    if (prevItem) {
        const list = listItem.parentElement;
        list.insertBefore(listItem, prevItem);
        updateTickersOrder(list.id.replace('-list', ''));
    }
}

// Переместить тикер вниз
function moveTickerDown(event, button) {
    event.stopPropagation();
    const listItem = button.closest('.ticker-item');
    const nextItem = listItem.nextElementSibling;

    if (nextItem) {
        const list = listItem.parentElement;
        list.insertBefore(nextItem, listItem);
        updateTickersOrder(list.id.replace('-list', ''));
    }
}

// Обновить порядок тикеров после перемещения
function updateTickersOrder(listType) {
    const list = document.getElementById(`${listType}-list`);
    const tickers = Array.from(list.children)
        .filter(item => item.classList.contains('ticker-item'))
        .map(item => item.dataset.ticker);

    // Переупорядочиваем объект tickersData
    const reorderedData = {};
    tickers.forEach(ticker => {
        reorderedData[ticker] = tickersData[listType][ticker];
    });

    tickersData[listType] = reorderedData;
    saveTickersToStorage();
}

// Редактирование тикера
function editTicker(ticker, listType) {
    currentTicker = ticker;
    currentListType = listType;
    const tickerData = tickersData[listType][ticker];

    modalTicker.textContent = ticker;
    priceInput.value = tickerData.price;
    changeInput.value = tickerData.change;
    priceModal.style.display = 'flex';
}

// Закрытие модального окна
function closeModal() {
    priceModal.style.display = 'none';
}

// Подтверждение ручного ввода цены
function confirmManualPrice() {
    const price = parseFloat(priceInput.value);
    const change = parseFloat(changeInput.value) || 0;

    if (!isNaN(price)) {
        tickersData[currentListType][currentTicker].price = price.toFixed(6);
        tickersData[currentListType][currentTicker].change = change.toFixed(2);

        // Обновляем на странице
        updateTickerOnPage(currentTicker, currentListType);
        saveTickersToStorage();
        closeModal();
    }
}

// Обновление тикера на странице
function updateTickerOnPage(ticker, listType) {
    const tickerData = tickersData[listType][ticker];
    const listItem = document.querySelector(`.ticker-item[data-ticker="${ticker}"][data-list-type="${listType}"]`);

    if (listItem) {
        const changeNum = parseFloat(tickerData.change);
        const changeClass = changeNum > 0 ?
                          'positive' :
                          changeNum < 0 ?
                          'negative' : 'neutral';

        const addedDate = new Date(tickerData.addedDate);
        const formattedDate = addedDate.toLocaleString();

        listItem.querySelector('.price-value').innerHTML = `$${tickerData.price} <span class="price-change ${changeClass}">${tickerData.change}%</span>`;
        listItem.querySelector('.added-date').textContent = formattedDate;
    }
}

// Удаление тикера
function removeTicker(event, button) {
    event.stopPropagation();
    const listItem = button.closest('.ticker-item');
    const ticker = listItem.dataset.ticker;
    const listType = listItem.dataset.listType;

    // Удаляем из объекта данных
    delete tickersData[listType][ticker];

    // Удаляем со страницы
    listItem.remove();

    // Сохраняем в localStorage
    saveTickersToStorage();
}

// Очистить все тикеры в списке
function clearAllTickers(listType) {
    if (confirm(`Вы уверены, что хотите удалить все тикеры из списка ${listType}?`)) {
        tickersData[listType] = {};
        document.getElementById(`${listType}-list`).innerHTML = '';
        saveTickersToStorage();
    }
}

// Обновление цены для одного тикера
async function updateTickerPrice(ticker, listType) {
    const tickerData = tickersData[listType][ticker];

    // Пропускаем обновление для ручных тикеров
    if (!tickerData.isBinance) return;

    try {
        let apiUrl;
        const marketType = tickerData.marketType;

        if (marketType === 'futures') {
            // Для фьючерсов используем Futures API
            apiUrl = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${ticker}`;
        } else {
            // Для спота используем Spot API
            apiUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${ticker}`;
        }

        const response = await fetch(apiUrl);

        if (response.ok) {
            const data = await response.json();
            const newPrice = parseFloat(data.lastPrice).toFixed(6);
            const newChange = parseFloat(data.priceChangePercent).toFixed(2);

            // Обновляем только если цена изменилась
            if (tickerData.price !== newPrice || tickerData.change !== newChange) {
                tickerData.price = newPrice;
                tickerData.change = newChange;

                // Анализируем тренд при обновлении цены
                const trend = await apiManager.analyzeTrend(ticker, marketType);
                if (trend) {
                    tickerData.trend = trend;
                }

                // Обновляем на странице
                updateTickerOnPage(ticker, listType);
                saveTickersToStorage();
            }
        }
    } catch (error) {
        console.error(`Ошибка при обновлении ${ticker}:`, error);
    }
}

// Обновление цен для всех тикеров
function updateAllPrices() {
    for (const listType in tickersData) {
        if (tickersData.hasOwnProperty(listType)) {
            for (const ticker in tickersData[listType]) {
                if (tickersData[listType].hasOwnProperty(ticker)) {
                    updateTickerPrice(ticker, listType);
                }
            }
        }
    }
}

// Обновление статистики
function updateStats() {
    let totalTickers = 0;
    let longCount = 0;
    let shortCount = 0;
    let longWaitCount = 0;
    let shortWaitCount = 0;

    for (const listType in tickersData) {
        if (tickersData.hasOwnProperty(listType)) {
            const count = Object.keys(tickersData[listType]).length;
            totalTickers += count;

            if (listType === 'long') longCount = count;
            if (listType === 'short') shortCount = count;
            if (listType === 'long-wait') longWaitCount = count;
            if (listType === 'short-wait') shortWaitCount = count;
        }
    }

    document.getElementById('total-tickers').textContent = totalTickers;
    document.getElementById('long-count').textContent = longCount;
    document.getElementById('short-count').textContent = shortCount;
    document.getElementById('long-wait-count').textContent = longWaitCount;
    document.getElementById('short-wait-count').textContent = shortWaitCount;
}

// Показать сообщение об ошибке
function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';

    setTimeout(() => {
        element.style.display = 'none';
    }, 3000);
}

// Скрыть сообщение об ошибке
function hideError(element) {
    element.style.display = 'none';
}

// Функции для работы с графиком TradingView
function openTradingViewChart(ticker, listType) {
    currentTicker = ticker;
    currentListType = listType;
    
    document.getElementById('chartModalTitle').textContent = ticker;
    document.getElementById('chartModal').style.display = 'flex';
    document.getElementById('chartError').classList.add('hidden');
    
    // Загружаем виджет TradingView
    loadTradingViewWidget(ticker);
}

function loadTradingViewWidget(ticker) {
    const widgetContainer = document.getElementById('tradingview-widget');
    widgetContainer.innerHTML = '';
    
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.onload = () => {
        // Виджет загружен успешно
        document.getElementById('chartError').classList.add('hidden');
    };
    script.onerror = () => {
        // Ошибка загрузки виджета
        document.getElementById('chartError').classList.remove('hidden');
    };
    
    script.innerHTML = JSON.stringify({
        "allow_symbol_change": true,
        "calendar": false,
        "details": false,
        "hide_side_toolbar": false,
        "hide_top_toolbar": false,
        "hide_legend": false,
        "hide_volume": false,
        "hotlist": false,
        "interval": "D",
        "locale": "ru",
        "save_image": true,
        "style": "0",
        "symbol": `BINANCE:${ticker}`,
        "theme": "dark",
        "timezone": "Etc/UTC",
        "backgroundColor": "rgba(0, 0, 0, 1)",
        "gridColor": "rgba(0, 0, 0, 0)",
        "watchlist": [],
        "withdateranges": false,
        "compareSymbols": [],
        "studies": [],
        "autosize": true
    });
    
    widgetContainer.appendChild(script);
}

function closeChartModal() {
    document.getElementById('chartModal').style.display = 'none';
}

// Menu functions
function toggleMenu() {
    const menuContent = document.getElementById('menuContent');
    if (menuContent) {
        menuContent.classList.toggle('show');
    }
}

function showCalculator() {
    toggleMenu();
    // Перенаправляем на страницу калькулятора
    window.location.href = 'calculator.html';
}

function showWidget() {
    toggleMenu();
    // Перенаправляем на страницу виджета
    window.location.href = 'widget.html';
}

function showMainPage() {
    toggleMenu();
    // Перенаправляем на главную страницу
    window.location.href = 'index.html';
}

function showLoginForm() {
    toggleMenu();
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showRegisterForm() {
    toggleMenu();
    const modal = document.getElementById('registerModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeRegisterModal() {
    const modal = document.getElementById('registerModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    apiManager = new BinanceAPIManager();

    try {
        await apiManager.init();

        // Проверяем авторизацию пользователя
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser.email) {
            updateUserUI(currentUser.email);
        }

        // Инициализация сортируемых списков
        initializeSortableLists();

        // Настройка обработчиков событий
        setupInputHandlers();

        // Загружаем тикеры из localStorage
        loadTickersFromStorage();

        // Обновляем статистику
        updateStats();

        // Запускаем обновление цен каждые 10 секунд
        setInterval(updateAllPrices, 10000);

        // Настройка обработчика для меню
        const menuButton = document.getElementById('menuButton');
        if (menuButton) {
            menuButton.addEventListener('click', toggleMenu);
        }

        // Закрываем меню при клике вне его
        window.addEventListener('click', function(event) {
            const menuContent = document.getElementById('menuContent');
            const menuButton = document.getElementById('menuButton');

            if (menuContent && menuButton &&
                !menuContent.contains(event.target) &&
                !menuButton.contains(event.target)) {
                menuContent.classList.remove('show');
            }
        });
    } catch (error) {
        console.error('Failed to initialize application:', error);
        showNotification('Critical Error', 'Failed to connect to Binance API');
    }
});

// Глобальные функции для вызова из HTML
window.copyToClipboard = copyToClipboard;
window.addTicker = addTicker;
window.clearAllTickers = clearAllTickers;
window.removeTicker = removeTicker;
window.editTicker = editTicker;
window.editComment = editComment;
window.saveComment = saveComment;
window.closeCommentModal = closeCommentModal;
window.closeModal = closeModal;
window.confirmManualPrice = confirmManualPrice;
window.rateTicker = rateTicker;
window.moveTickerUp = moveTickerUp;
window.moveTickerDown = moveTickerDown;
window.showCalculator = showCalculator;
window.showWidget = showWidget;
window.showMainPage = showMainPage;
window.showLoginForm = showLoginForm;
window.closeLoginModal = closeLoginModal;
window.showRegisterForm = showRegisterForm;
window.closeRegisterModal = closeRegisterModal;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
window.toggleMenu = toggleMenu;
window.openTradingViewChart = openTradingViewChart;
window.closeChartModal = closeChartModal;
