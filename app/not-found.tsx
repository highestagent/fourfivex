import { AppNavigation } from "@/components/AppNavigation";

export default function NotFound() {
  return (
    <>
      <header className="border-b border-line">
        <div className="shell flex min-h-14 items-center sm:min-h-[60px]">
          <AppNavigation />
        </div>
      </header>
      <main className="shell py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      </main>
    </>
  );
}
