/*
 * Angelic Booking embed. Drop this on any website:
 *
 *   <script src="https://app.angelicbooking.com/embed.js" data-angelic="your-slug" async></script>
 *
 * Attributes (all optional except data-angelic):
 *   data-mode="inline" (default) renders the booking flow where the tag sits;
 *   data-mode="popup" renders a button that opens the flow in an overlay.
 *   data-service / data-staff / data-location preselect a step (ids from Settings → Embed).
 *   data-label  button text (popup mode)          data-color  button colour, e.g. #6d28d9
 *   data-min-height  starting height in px (inline mode, default 640)
 * Also available: window.AngelicBooking.open(slug, opts) / close().
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;
  var slug = script.getAttribute("data-angelic");
  if (!slug) return;
  var mode = script.getAttribute("data-mode") || "inline";
  var color = script.getAttribute("data-color") || "#6d28d9";
  var label = script.getAttribute("data-label") || "Book now";
  var minHeight = parseInt(script.getAttribute("data-min-height") || "640", 10);

  function url(s, opts) {
    var p = new URLSearchParams();
    ["service", "staff", "location"].forEach(function (k) {
      var v = (opts && opts[k]) || script.getAttribute("data-" + k);
      if (v) p.set(k, v);
    });
    var q = p.toString();
    return origin + "/embed/" + encodeURIComponent(s) + (q ? "?" + q : "");
  }

  function makeFrame(s, opts) {
    var f = document.createElement("iframe");
    f.src = url(s, opts);
    f.title = "Book an appointment";
    f.setAttribute("allow", "payment");
    f.setAttribute("loading", "lazy");
    f.style.cssText = "width:100%;border:0;display:block;background:transparent;";
    f.setAttribute("data-angelic-frame", "1");
    return f;
  }

  // Frames report their content height; resize the matching iframe.
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== "angelic:height") return;
    var frames = document.querySelectorAll("iframe[data-angelic-frame]");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) frames[i].style.height = Math.max(minHeight, e.data.height + 8) + "px";
    }
  });

  var overlay = null;
  function open(s, opts) {
    close();
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(28,25,23,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto;";
    var box = document.createElement("div");
    box.style.cssText = "position:relative;width:min(680px,100%);background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;";
    var x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.innerHTML = "&times;";
    x.style.cssText = "position:absolute;top:8px;right:8px;z-index:1;width:36px;height:36px;border:0;border-radius:999px;background:#f5f5f4;color:#1c1917;font-size:22px;line-height:36px;cursor:pointer;";
    x.onclick = close;
    var f = makeFrame(s || slug, opts);
    f.style.minHeight = "560px";
    f.setAttribute("loading", "eager");
    box.appendChild(x);
    box.appendChild(f);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
  }
  window.AngelicBooking = { open: open, close: close };

  if (mode === "popup") {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = "display:inline-block;background:" + color + ";color:#fff;border:0;padding:12px 22px;border-radius:10px;font:600 15px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;";
    b.onclick = function () { open(slug); };
    script.parentNode.insertBefore(b, script.nextSibling);
  } else {
    var frame = makeFrame(slug);
    frame.style.minHeight = minHeight + "px";
    script.parentNode.insertBefore(frame, script.nextSibling);
  }
})();
