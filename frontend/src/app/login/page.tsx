export default function LoginPage() {
  return (
    <div className="p-4 max-w-sm mx-auto">
      <form
        className="space-y-3 bg-white/5 backdrop-blur border border-white/10 p-4 rounded-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const username = (form.elements.namedItem("username") as HTMLInputElement).value;
          const password = (form.elements.namedItem("password") as HTMLInputElement).value;
          try {
            const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
            const res = await fetch(`${api}/api/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username, password }),
            });
            if (!res.ok) {
              alert("Login failed");
              return;
            }
            const data = await res.json();
            localStorage.setItem("docpilot_token", data.token);
            window.location.href = "/ask";
          } catch (err) {
            alert("Login error");
          }
        }}
      >
        <h1 className="text-xl font-semibold mb-2">Login</h1>
        <div>
          <label className="block text-sm mb-1">Username</label>
          <input name="username" className="w-full rounded bg-white/10 p-2" />
        </div>
        <div>
          <label className="block text-sm mb-1">Password</label>
          <input name="password" type="password" className="w-full rounded bg-white/10 p-2" />
        </div>
        <button className="w-full mt-2 bg-sky-600 hover:bg-sky-700 text-white rounded p-2">Sign In</button>
      </form>
    </div>
  );
}
