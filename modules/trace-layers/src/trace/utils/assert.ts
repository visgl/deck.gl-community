export const assert = (condition: boolean, message = 'Assertion failed.'): void => {
  if (!condition) {
    throw new Error(message);
  }
};
