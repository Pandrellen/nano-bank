"use server";

export interface SignUpResult {
  success: boolean;
  message: string;
}

export async function signUpAction(formData: FormData): Promise<SignUpResult> {
  const email = formData.get("email");
  const phoneNumber = formData.get("phoneNumber");
  const firstName = formData.get("firstName");
  const lastName = formData.get("lastName");
  const dateOfBirth = formData.get("dateOfBirth");
  const sin = formData.get("sin");
  const password = formData.get("password");

  console.log("Sign-up action triggered with fields:", {
    email,
    phoneNumber,
    firstName,
    lastName,
    dateOfBirth,
    sin,
    password: password ? "[REDACTED]" : null,
  });

  // Placeholder logic: simulating successful creation or simple check
  if (!email || !password || !firstName || !lastName || !phoneNumber || !dateOfBirth || !sin) {
    return {
      success: false,
      message: "All fields are required.",
    };
  }

  // Simulate server validation delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    success: true,
    message: `Account successfully created for ${firstName} ${lastName}!`,
  };
}

export interface SignInResult {
  success: boolean;
  message: string;
}

export async function signInAction(formData: FormData): Promise<SignInResult> {
  const email = formData.get("email");
  const password = formData.get("password");

  console.log("Sign-in action triggered with fields:", {
    email,
    password: password ? "[REDACTED]" : null,
  });

  if (!email || !password) {
    return {
      success: false,
      message: "Email and password are required.",
    };
  }

  // Simulate server sign-in validation delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Placeholder logic: allowing any sign in for now
  return {
    success: true,
    message: "Successfully signed in!",
  };
}
