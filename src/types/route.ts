export interface CloneRoute {
  id: number;
  category: string;
  name: string | null;
  path: string;
  sourceUrl: string;
  dynamic: boolean;
  status: "pending-inspection" | "inspected" | "implemented" | "verified" | "source-unavailable";
  requiresFixture: boolean;
}
