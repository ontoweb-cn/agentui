interface AppProps {
  greeting: string;
  hint: string;
  hostApiVersion: string;
}

export function App({ greeting, hint, hostApiVersion }: AppProps) {
  return (
    <div className="hello-world">
      <h1>{greeting}</h1>
      <p>{hint}</p>
      <p>host API: {hostApiVersion}</p>
    </div>
  );
}
