export const SIGNED_OUT_ATTR = "data-signed-out";

/** Before first paint: no stored session on an admin page means the login is coming, whose page is black. AuthGate clears it once it knows. */
export const LOGIN_BOOT_SCRIPT = `(function(){try{if(/^\\/(worker|catalog)(\\/|$)/.test(location.pathname))return;for(var i=0;i<localStorage.length;i++)if(/^sb-.+-auth-token$/.test(localStorage.key(i)||""))return;document.documentElement.setAttribute(${JSON.stringify(SIGNED_OUT_ATTR)},"");}catch(e){}})();`;
