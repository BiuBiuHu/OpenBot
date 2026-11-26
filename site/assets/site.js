(function () {
  var copied = document.documentElement.lang.indexOf("zh") === 0 ? "已复制" : "Copied";
  var idle = document.documentElement.lang.indexOf("zh") === 0 ? "复制" : "Copy";

  var failed = document.documentElement.lang.indexOf("zh") === 0 ? "无法复制" : "Copy failed";

  document.querySelectorAll(".copy").forEach(function (button) {
    button.addEventListener("click", function () {
      var value = button.getAttribute("data-copy") || "";
      if (!value) return;
      var reset = function () {
        button.textContent = idle;
        button.removeAttribute("data-copied");
      };
      var ok = function () {
        button.textContent = copied;
        button.setAttribute("data-copied", "true");
        window.setTimeout(reset, 1600);
      };
      var fail = function () {
        button.textContent = failed;
        button.removeAttribute("data-copied");
        window.setTimeout(reset, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(ok, fail);
        return;
      }
      ok();
    });
  });
})();
