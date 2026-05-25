// Front-shop sales departments — matches /reports/daily-sales scope.
export const SALES_DEPT_CODES = ["2012", "2022", "2032", "2062"] as const;

export const SALES_DEPTS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "2012", name: "ຂາຍໜ້າຮ້ານເຄື່ອງໃຊ້ໄຟຟ້າ" },
  { code: "2022", name: "ຂາຍໜ້າຮ້ານແອ" },
  { code: "2032", name: "ຂາຍໜ້າຮ້ານປະປາ" },
  { code: "2062", name: "ຂາຍໜ້າຮ້ານໄຟຟ້າຂະໜາດນ້ອຍ" },
];
