// BYO Player: lets the browser install the app. Nothing is cached; every request goes to the network.
self.addEventListener('install',function(){ self.skipWaiting(); });
self.addEventListener('activate',function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch',function(){});
