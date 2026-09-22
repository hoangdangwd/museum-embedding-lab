Dự án Tìm kiếm hiện vật bảo tàng (Gamification / Sưu tập tem)
Mục tiêu: Thay thế việc quét mã QR truyền thống bằng trải nghiệm tương tác trực quan, biến việc tham quan bảo tàng thành một trò chơi săn tìm hiện vật (sưu tập tem).   
Ý tưởng & Trải nghiệm người dùng (UX):Người dùng sở hữu một "quyển sổ sưu tập tem" ảo.   Ứng dụng đưa ra manh mối/câu hỏi gợi ý để tìm hiện vật tương ứng trong bảo tàng.   
Người dùng tìm thấy hiện vật, chụp ảnh tải lên.   
Hệ thống xác thực xem ảnh chụp có đúng hiện vật hay không. 
Nếu đúng, hiện vật sẽ biến thành một con tem lưu vào sổ sưu tập kèm lời giải thích/thông tin chi tiết.   
Công nghệ & Kiến trúc giải pháp:Multimodal Embedding: Sử dụng mô hình embedding hỗ trợ hình ảnh (có sẵn qua OpenRouter) để vector hóa cả ảnh mẫu lẫn ảnh người dùng chụp (Image-to-Image search).   
Vector Database: Sử dụng vector database dạng in-memory hoặc chạy cục bộ trên máy để truy vấn độ tương đồng nhanh chóng.   
Fuzzy Matching: Khả năng nhận diện dựa trên vector embedding giúp đối chiếu linh hoạt (không phụ thuộc vào góc chụp, ánh sáng hay mặt trước/sau của vật phẩm).   
Kế hoạch thử nghiệm (PoC):Tự tạo dữ liệu mẫu với 5 – 7 vật phẩm có sẵn trong phòng.   
Mỗi vật phẩm chụp nhiều góc độ khác nhau để làm dữ liệu quản trị/đối chiếu.   
Xây dựng tính năng chụp ảnh mới để kiểm tra độ chính xác của cơ chế search. 