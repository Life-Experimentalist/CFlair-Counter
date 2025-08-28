// CFlairCounter Service Worker v2.0
// Enhanced caching and performance optimization

const CACHE_NAME = 'cflaircounter-v2.0';
const API_CACHE_NAME = 'cflaircounter-api-v2.0';

// Static resources to cache
const STATIC_RESOURCES = [
    '/',
    '/index.html',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/particles.js/2.0.0/particles.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

// API endpoints that should be cached
const API_ENDPOINTS = [
    '/api/stats',
    '/api/projects'
];

// Install event - cache static resources
self.addEventListener('install', event => {
    console.log('[SW] Installing service worker...');
    
    event.waitUntil(
        Promise.all([
            // Cache static resources
            caches.open(CACHE_NAME).then(cache => {
                console.log('[SW] Caching static resources');
                return cache.addAll(STATIC_RESOURCES.map(url => 
                    new Request(url, { mode: 'cors' })
                ));
            }),
            // Cache API endpoints
            caches.open(API_CACHE_NAME).then(cache => {
                console.log('[SW] Pre-caching API endpoints');
                return Promise.all(
                    API_ENDPOINTS.map(endpoint => {
                        return fetch(endpoint)
                            .then(response => {
                                if (response.ok) {
                                    return cache.put(endpoint, response);
                                }
                            })
                            .catch(err => console.log(`[SW] Failed to pre-cache ${endpoint}:`, err));
                    })
                );
            })
        ]).then(() => {
            console.log('[SW] Installation complete');
            return self.skipWaiting();
        })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating service worker...');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Activation complete');
            return self.clients.claim();
        })
    );
});

// Fetch event - handle network requests
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests and external URLs (except our CDN resources)
    if (request.method !== 'GET') {
        return;
    }
    
    // Handle different types of requests
    if (isStaticResource(request.url)) {
        event.respondWith(handleStaticResource(request));
    } else if (isAPIRequest(url.pathname)) {
        event.respondWith(handleAPIRequest(request));
    } else if (isBadgeRequest(url.pathname)) {
        event.respondWith(handleBadgeRequest(request));
    } else {
        event.respondWith(handleGenericRequest(request));
    }
});

// Check if URL is a static resource
function isStaticResource(url) {
    return STATIC_RESOURCES.some(resource => url.includes(resource)) ||
           url.includes('fonts.googleapis.com') ||
           url.includes('fonts.gstatic.com') ||
           url.includes('cdnjs.cloudflare.com') ||
           url.includes('cdn.tailwindcss.com');
}

// Check if request is for API
function isAPIRequest(pathname) {
    return pathname.startsWith('/api/') && !pathname.includes('/badge');
}

// Check if request is for badge
function isBadgeRequest(pathname) {
    return pathname.includes('/badge');
}

// Handle static resources with cache-first strategy
async function handleStaticResource(request) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            console.log('[SW] Serving from cache:', request.url);
            
            // Update cache in background
            fetch(request).then(response => {
                if (response.ok) {
                    cache.put(request, response.clone());
                }
            }).catch(() => {}); // Ignore errors
            
            return cachedResponse;
        }
        
        console.log('[SW] Fetching from network:', request.url);
        const response = await fetch(request);
        
        if (response.ok) {
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        console.error('[SW] Error handling static resource:', error);
        return new Response('Resource not available', { status: 503 });
    }
}

// Handle API requests with network-first strategy
async function handleAPIRequest(request) {
    try {
        console.log('[SW] API request:', request.url);
        
        // Try network first
        const response = await fetch(request);
        
        if (response.ok) {
            // Cache successful responses for fallback
            const cache = await caches.open(API_CACHE_NAME);
            cache.put(request, response.clone());
            console.log('[SW] Cached API response:', request.url);
        }
        
        return response;
    } catch (error) {
        console.log('[SW] Network failed, trying cache:', request.url);
        
        // Fallback to cache
        const cache = await caches.open(API_CACHE_NAME);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            console.log('[SW] Serving stale API data from cache');
            return cachedResponse;
        }
        
        // Return offline response
        return new Response(JSON.stringify({
            success: false,
            error: 'Offline - no cached data available'
        }), {
            status: 503,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    }
}

// Handle badge requests with cache-first strategy (badges rarely change)
async function handleBadgeRequest(request) {
    try {
        const cache = await caches.open(API_CACHE_NAME);
        const cachedResponse = await cache.match(request);
        
        // Check if cached response is still fresh (1 hour)
        if (cachedResponse) {
            const cacheDate = new Date(cachedResponse.headers.get('date'));
            const isExpired = Date.now() - cacheDate.getTime() > 3600000; // 1 hour
            
            if (!isExpired) {
                console.log('[SW] Serving fresh badge from cache');
                return cachedResponse;
            }
        }
        
        console.log('[SW] Fetching fresh badge from network');
        const response = await fetch(request);
        
        if (response.ok) {
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        console.log('[SW] Badge network failed, trying cache');
        
        const cache = await caches.open(API_CACHE_NAME);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return placeholder badge if offline
        return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="104" height="20"><rect width="104" height="20" fill="#555"/><text x="52" y="15" fill="white" text-anchor="middle" font-family="Arial" font-size="11">Offline</text></svg>',
            {
                status: 200,
                headers: {
                    'Content-Type': 'image/svg+xml',
                    'Cache-Control': 'no-cache'
                }
            }
        );
    }
}

// Handle generic requests
async function handleGenericRequest(request) {
    try {
        return await fetch(request);
    } catch (error) {
        // Return offline page or cached version if available
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match('/');
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response('Offline', { status: 503 });
    }
}

// Background sync for analytics (when network is restored)
self.addEventListener('sync', event => {
    if (event.tag === 'analytics-sync') {
        console.log('[SW] Syncing analytics data...');
        event.waitUntil(syncAnalytics());
    }
});

// Sync pending analytics data
async function syncAnalytics() {
    try {
        // In a real implementation, you would sync any pending analytics data
        console.log('[SW] Analytics sync completed');
    } catch (error) {
        console.error('[SW] Analytics sync failed:', error);
    }
}

// Push notification support (for future admin alerts)
self.addEventListener('push', event => {
    if (!event.data) return;
    
    const data = event.data.json();
    const options = {
        body: data.body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        data: data,
        actions: [
            {
                action: 'view',
                title: 'View',
                icon: '/favicon.ico'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    if (event.action === 'view') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Message handling from main thread
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CACHE_BADGE') {
        const { url } = event.data;
        caches.open(API_CACHE_NAME).then(cache => {
            return fetch(url).then(response => {
                if (response.ok) {
                    return cache.put(url, response);
                }
            });
        }).catch(err => console.log('[SW] Failed to cache badge:', err));
    }
});

console.log('[SW] Service Worker script loaded');
