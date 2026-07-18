import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { ProofLatchApp } from "./ProofLatchApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();

  return (
    <ProofLatchApp
      user={user ? { displayName: user.displayName } : null}
      signInPath={chatGPTSignInPath("/")}
    />
  );
}
