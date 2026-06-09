import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LanguageToggle } from "./LanguageToggle";

describe("LanguageToggle", () => {
  it("renders both language options and reports changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<LanguageToggle locale="zh" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "English" }));

    expect(onChange).toHaveBeenCalledWith("en");
  });
});
