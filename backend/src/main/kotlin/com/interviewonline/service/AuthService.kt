package com.interviewonline.service

import com.interviewonline.dto.AuthResponse
import com.interviewonline.dto.LoginRequest
import com.interviewonline.dto.RegisterRequest
import com.interviewonline.dto.UpdateProfileRequest
import com.interviewonline.dto.UserDto
import com.interviewonline.model.User
import com.interviewonline.model.UserSession
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import org.springframework.http.HttpStatus
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Service
import java.util.UUID

@Service
class AuthService(
    private val userRepository: UserRepository,
    private val userSessionRepository: UserSessionRepository,
    private val userTaskService: UserTaskService,
) {
    companion object {
        const val ROLE_USER = "user"
        const val ROLE_ADMIN = "admin"
    }

    private val passwordEncoder = BCryptPasswordEncoder()

    fun register(request: RegisterRequest): AuthResponse {
        val displayName = request.displayName.trim()
        val nickname = request.nickname.trim()
        if (nickname.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Ник обязателен")
        }
        if (nickname.length < 3 || nickname.length > 32) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Ник должен быть от 3 до 32 символов")
        }
        if (nickname.any { it.isWhitespace() }) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Ник не должен содержать пробелы")
        }
        if (userRepository.findByNickname(nickname) != null) {
            throw ApiException(HttpStatus.CONFLICT, "Ник уже занят")
        }
        val user = userRepository.save(
            User(
                nickname = nickname,
                displayName = displayName,
                passwordHash = passwordEncoder.encode(request.password),
                role = ROLE_USER,
            ),
        )
        userTaskService.initializeTaskBank(user)
        return createSession(user)
    }

    fun login(request: LoginRequest): AuthResponse {
        val user = userRepository.findByNickname(request.nickname.trim())
            ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Неверный ник или пароль")
        if (!passwordEncoder.matches(request.password, user.passwordHash)) {
            throw ApiException(HttpStatus.UNAUTHORIZED, "Неверный ник или пароль")
        }
        return createSession(user)
    }

    fun requireUserByToken(token: String?): User {
        if (token.isNullOrBlank()) {
            throw ApiException(HttpStatus.UNAUTHORIZED, "Отсутствует токен авторизации")
        }
        val session = userSessionRepository.findByToken(token)
            ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Недействительный токен авторизации")
        val user = session.user ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Сессия не найдена")
        return user
    }

    fun resolveUserByToken(token: String?): User? {
        if (token.isNullOrBlank()) return null
        val session = userSessionRepository.findByToken(token) ?: return null
        val user = session.user ?: return null
        return user
    }

    fun updateProfile(user: User, request: UpdateProfileRequest): UserDto {
        val displayName = request.displayName.trim()
        if (displayName.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Имя обязательно")
        }
        user.displayName = displayName
        val saved = userRepository.save(user)
        return saved.toDto()
    }

    private fun createSession(user: User): AuthResponse {
        val token = "usr_${UUID.randomUUID()}"
        userSessionRepository.save(UserSession(user = user, token = token))
        return AuthResponse(
            token = token,
            user = user.toDto(),
        )
    }

    private fun User.toDto(): UserDto {
        return UserDto(
            id = id!!,
            nickname = nickname,
            displayName = displayName.orEmpty(),
            role = role,
        )
    }
}
