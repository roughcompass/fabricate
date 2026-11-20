import { useState } from "react";

export default function Settings() {
  const [saved, setSaved] = useState(false);

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">How the orders team hears about new orders.</p>
      <form
        className="settings"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(true);
        }}
      >
        <label htmlFor="display-name">Display name</label>
        <input id="display-name" name="displayName" defaultValue="Orders team" />
        <label className="check">
          <input type="checkbox" name="digest" defaultChecked /> Email me a daily digest
        </label>
        <div>
          <button type="submit">Save settings</button>
        </div>
        {saved && <p className="saved">Settings saved.</p>}
      </form>
    </>
  );
}
