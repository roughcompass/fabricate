function cookie(name) {
  const found = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

/** The signed-in user's role, from `desk:user`: JSON with a role, or the text as it is. */
function role(user) {
  if (user === null) return null;
  try {
    const parsed = JSON.parse(user);
    return parsed && typeof parsed.role === "string" ? parsed.role : user;
  } catch {
    return user;
  }
}

export function readStartup() {
  return {
    user: role(window.localStorage.getItem("desk:user")),
    tab: window.sessionStorage.getItem("desk-tab"),
    region: cookie("desk-region"),
    desk: new URLSearchParams(window.location.search).get("desk"),
  };
}
