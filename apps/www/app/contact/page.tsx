export default function ContactPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-md px-4 text-center">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Contact Us
        </h1>
        <p className="mt-4 text-neutral-600 dark:text-neutral-400">
          Have questions or feedback? We'd love to hear from you.
        </p>
        <p className="mt-6">
          <a
            href="mailto:austin@manaflow.com"
            className="text-lg font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            austin@manaflow.com
          </a>
        </p>
      </div>
    </div>
  );
}
