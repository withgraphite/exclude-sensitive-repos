export async function sleep(args: { milliseconds: number }): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, args.milliseconds);
  });
}
