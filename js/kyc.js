// فرم عمومی احراز همکار — توکن از آدرس /kyc/<token> خوانده می‌شود
(function () {
  var token = location.pathname.split("/").pop();
  var api = "/api/v1/public/kyc/" + encodeURIComponent(token);
  function $(id) { return document.getElementById(id); }
  function msg(t, bad) { $("kyMsg").textContent = t; $("kyMsg").style.color = bad ? "#b4444a" : ""; }

  fetch(api)
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "خطا"); return j; }); })
    .then(function (d) {
      if (d.status === "pending") { msg("مدارک شما دریافت شده و در حال بررسی است. نتیجه با پیامک اطلاع داده می‌شود."); return; }
      if (d.status === "approved") { msg("همکاری شما تأیید شده است."); return; }
      $("ky_name").value = d.name || "";
      $("ky_shop").value = d.shopName || "";
      $("ky_city").value = d.city || "";
      $("ky_job").innerHTML = '<option value="">انتخاب…</option>' + (d.jobTypes || []).map(function (j) { return "<option>" + j + "</option>"; }).join("");
      $("ky_job").value = d.jobType || "";
      if (d.reason) { $("kyReason").hidden = false; $("kyReason").textContent = "نیاز به اصلاح: " + d.reason; }
      $("kyForm").hidden = false;
      msg("مشخصات را کامل کنید و تصویر مدرک را بفرستید.");
    })
    .catch(function (e) { msg(e.message, true); });

  $("kyForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var files = $("ky_files").files;
    if (!files.length) { msg("تصویر مدرک را انتخاب کنید", true); return; }
    if (files.length > 4) { msg("حداکثر ۴ فایل", true); return; }
    var fd = new FormData();
    fd.append("name", $("ky_name").value.trim());
    fd.append("shopName", $("ky_shop").value.trim());
    fd.append("city", $("ky_city").value.trim());
    fd.append("jobType", $("ky_job").value);
    fd.append("nationalId", $("ky_nid").value.trim());
    for (var i = 0; i < files.length; i++) fd.append("documents", files[i]);
    var b = $("kySubmit");
    b.disabled = true;
    b.textContent = "در حال ارسال…";
    fetch(api, { method: "POST", body: fd })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "خطا"); return j; }); })
      .then(function () { $("kyForm").hidden = true; msg("مدارک شما رسید. بعد از بررسی، نتیجه با پیامک اطلاع داده می‌شود. سپاس از همکاری شما."); })
      .catch(function (err) { msg(err.message, true); b.disabled = false; b.textContent = "ارسال مدارک"; });
  });
})();
