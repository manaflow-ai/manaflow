import { cn } from "@/lib/utils";

interface CommentAvatarProps {
  profileImageUrl?: string | null;
  userId?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-5 h-5 text-[10px]",
  md: "w-6 h-6 text-xs",
  lg: "w-8 h-8 text-sm",
};

export function CommentAvatar({
  profileImageUrl,
  userId,
  size = "md",
  className,
}: CommentAvatarProps) {
  const sizeClass = sizeClasses[size];

  if (profileImageUrl) {
    return (
      <img
        src={profileImageUrl}
        alt="User avatar"
        className={cn(
          "rounded-full flex-shrink-0 object-cover",
          sizeClass,
          className
        )}
      />
    );
  }

  // Gradient fallback based on userId hash
  const getGradient = (id?: string) => {
    if (!id) return "from-blue-500 to-blue-600";
    const hash = id.split("").reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
    const gradients = [
      "from-blue-500 to-blue-600",
      "from-purple-500 to-purple-600",
      "from-green-500 to-green-600",
      "from-orange-500 to-orange-600",
      "from-pink-500 to-pink-600",
      "from-teal-500 to-teal-600",
    ];
    return gradients[Math.abs(hash) % gradients.length];
  };

  const initial = userId?.[0]?.toUpperCase() ?? "U";

  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br flex items-center justify-center text-white font-medium flex-shrink-0",
        getGradient(userId),
        sizeClass,
        className
      )}
    >
      {initial}
    </div>
  );
}
