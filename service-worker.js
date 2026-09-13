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

  const title = data.title || "ChatBGM";
  const options = {
    body: data.body || "You have a new message.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [300, 150, 300, 150, 300],
    tag: "chat-msg-" + Date.now(),
    renotify: true,
    requireInteraction: false,
    data: {
      url: data.url || "/"
    }
  };

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Check if any tab running this app is currently open, visible, and focused
      const isAppActive = clientList.some((client) => client.visibilityState === "visible" && client.focused);

      // If the user is actively chatting inside the app, suppress the notification
      if (isAppActive) {
        return;
      }

      // Show notification if app is closed, locked, or backgrounded
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification?.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
