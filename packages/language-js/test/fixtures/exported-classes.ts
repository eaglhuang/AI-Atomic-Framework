export class RowStore {
  private readonly rows: string[] = [];

  add(row: string): void {
    this.rows.push(row);
  }

  list(): readonly string[] {
    return this.rows;
  }
}

export abstract class BaseReporter {
  abstract report(): string;
}
