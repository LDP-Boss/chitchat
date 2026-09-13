const CACHE_NAME = "chatbgm-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "ChatBGM",
      body: event.data ? event.data.text() : "You have a new message."
    };
  }

  const isCall = (data.body || '').includes('call');
  const title = data.title || (isCall ? "Incoming Call" : "ChatBGM");

  const options = {
    body: data.body || "You have a new message.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: isCall ? [500, 250, 500, 250, 500, 250, 500] : [200, 100, 200],
    tag: isCall ? "chat-call-alert" : ("chat-msg-" + Date.now()),
    renotify: true,
    requireInteraction: isCall,
    data: {
      url: data.url || "/"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
